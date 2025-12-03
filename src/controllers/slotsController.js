import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { Op } from 'sequelize';
import { BusinessHour, Block, Appointment } from '../models/index.js';

dayjs.extend(utc);

const dayMap = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function parseHHMM(str) {
  const [h, m] = String(str).split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return !(aEnd <= bStart || aStart >= bEnd);
}

export const getSlots = async (req, res) => {
  try {
    const location_id = String(req.query.location_id || '');
    const doctor_id = String(req.query.doctor_id || '');
    const days = Number(req.query.days || 14);
    const slotMinutes = Number(req.query.slot || 30);

    if (!location_id || !doctor_id) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (!/^\d+$/.test(location_id) || !/^\d+$/.test(doctor_id)) {
      return res.status(400).json({ error: 'invalid_ids' });
    }
    if (!Number.isFinite(days) || days < 1 || days > 60) {
      return res.status(400).json({ error: 'invalid_days' });
    }
    if (!Number.isFinite(slotMinutes) || slotMinutes < 10 || slotMinutes > 120) {
      return res.status(400).json({ error: 'invalid_slot' });
    }

    // business hours for doctor and location
    const bhs = await BusinessHour.findAll({
      where: { doc: doctor_id, clin: location_id },
      raw: true,
    });

    // collect blocks and appointments in the time window [now, now+days]
    const startWindow = dayjs().utc().startOf('day');
    const endWindow = startWindow.add(days, 'day');
    const startTs = Math.floor(startWindow.unix());
    const endTs = Math.floor(endWindow.unix());

    const blocks = await Block.findAll({
      where: {
        doc: doctor_id,
        active: 1,
        [Op.or]: [
          { start_ts: { [Op.between]: [startTs, endTs] } },
          { end_ts: { [Op.between]: [startTs, endTs] } },
          { start_ts: { [Op.lte]: startTs }, end_ts: { [Op.gte]: endTs } },
        ],
      },
      raw: true,
    });

    const apps = await Appointment.findAll({
      where: {
        doc: doctor_id,
        cli: location_id,
        active: 1,
        [Op.or]: [
          { start_ts: { [Op.between]: [startTs, endTs] } },
          { end_ts: { [Op.between]: [startTs, endTs] } },
          { start_ts: { [Op.lte]: startTs }, end_ts: { [Op.gte]: endTs } },
        ],
      },
      raw: true,
    });

    const taken = apps.map(a => [Number(a.start_ts), Number(a.end_ts)]);
    const blocked = blocks.map(b => [Number(b.start_ts), Number(b.end_ts)]);

    const out = [];

    for (let d = 0; d < days; d++) {
      const day = startWindow.add(d, 'day');
      const dow = day.day();

      const todays = bhs.filter(bh => dayMap[String(bh.day).toLowerCase()] === dow);
      for (const bh of todays) {
        const { h: sh, m: sm } = parseHHMM(bh.start);
        const { h: eh, m: em } = parseHHMM(bh.end);

        let cur = day.clone().hour(sh).minute(sm).second(0);
        const end = day.clone().hour(eh).minute(em).second(0);

        while (cur.add(slotMinutes, 'minute').isSameOrBefore(end)) {
          const slotStart = cur.unix();
          const slotEnd = cur.add(slotMinutes, 'minute').unix();

          const conflict = taken.some(([s, e]) => overlaps(slotStart, slotEnd, s, e)) ||
                           blocked.some(([s, e]) => overlaps(slotStart, slotEnd, s, e));

          if (!conflict) {
            out.push({ start_ts: slotStart, end_ts: slotEnd });
          }

          cur = cur.add(slotMinutes, 'minute');
        }
      }
    }

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

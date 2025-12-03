import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { Op } from 'sequelize';
import { BusinessHour, Block, Appointment } from '../models/index.js';

dayjs.extend(utc);

const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const parseHHMM = (str) => { const [h, m] = String(str).split(':').map(Number); return { h: h || 0, m: m || 0 }; };
const overlaps = (aStart, aEnd, bStart, bEnd) => !(aEnd <= bStart || aStart >= bEnd);

export const getCalendarDays = async (req, res) => {
  try {
    const location_id = String(req.query.location_id || '');
    const doctor_id = String(req.query.doctor_id || '');
    const from = String(req.query.from || dayjs().format('YYYY-MM-DD'));
    const days = Number(req.query.days || 14);
    const slotMinutes = Number(req.query.slot || 30);

    if (!/^\d+$/.test(location_id) || !/^\d+$/.test(doctor_id)) {
      return res.status(400).json({ error: 'invalid_ids' });
    }
    const startWindow = dayjs.utc(from, 'YYYY-MM-DD').startOf('day');
    if (!startWindow.isValid()) return res.status(400).json({ error: 'invalid_from' });

    const endWindow = startWindow.add(days, 'day');
    const startTs = startWindow.unix();
    const endTs = endWindow.unix();

    const bhs = await BusinessHour.findAll({ where: { doc: doctor_id, clin: location_id }, raw: true });
    const blocks = await Block.findAll({ where: { doc: doctor_id, active: 1, [Op.or]: [ { start_ts: { [Op.between]: [startTs, endTs] } }, { end_ts: { [Op.between]: [startTs, endTs] } }, { start_ts: { [Op.lte]: startTs }, end_ts: { [Op.gte]: endTs } } ] }, raw: true });
    const apps = await Appointment.findAll({ where: { doc: doctor_id, cli: location_id, active: 1, [Op.or]: [ { start_ts: { [Op.between]: [startTs, endTs] } }, { end_ts: { [Op.between]: [startTs, endTs] } }, { start_ts: { [Op.lte]: startTs }, end_ts: { [Op.gte]: endTs } } ] }, raw: true });

    const taken = apps.map(a => [Number(a.start_ts), Number(a.end_ts)]);
    const blocked = blocks.map(b => [Number(b.start_ts), Number(b.end_ts)]);

    const out = [];
    for (let d = 0; d < days; d++) {
      const day = startWindow.add(d, 'day');
      const dow = day.day();
      const todays = bhs.filter(bh => dayMap[String(bh.day).toLowerCase()] === dow);
      let count = 0;
      for (const bh of todays) {
        const { h: sh, m: sm } = parseHHMM(bh.start);
        const { h: eh, m: em } = parseHHMM(bh.end);
        let cur = day.clone().hour(sh).minute(sm).second(0);
        const end = day.clone().hour(eh).minute(em).second(0);
        while (cur.add(slotMinutes, 'minute').isSameOrBefore(end)) {
          const slotStart = cur.unix();
          const slotEnd = cur.add(slotMinutes, 'minute').unix();
          const conflict = taken.some(([s, e]) => overlaps(slotStart, slotEnd, s, e)) || blocked.some(([s, e]) => overlaps(slotStart, slotEnd, s, e));
          if (!conflict) count++;
          cur = cur.add(slotMinutes, 'minute');
        }
      }
      if (count > 0) out.push({ date: day.format('YYYY-MM-DD'), slots: count });
    }

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

export const getCalendarSlots = async (req, res) => {
  try {
    const location_id = String(req.query.location_id || '');
    const doctor_id = String(req.query.doctor_id || '');
    const date = String(req.query.date || '');
    const slotMinutes = Number(req.query.slot || 30);
    if (!/^\d+$/.test(location_id) || !/^\d+$/.test(doctor_id)) return res.status(400).json({ error: 'invalid_ids' });
    const day = dayjs.utc(date, 'YYYY-MM-DD');
    if (!day.isValid()) return res.status(400).json({ error: 'invalid_date' });

    const startWindow = day.startOf('day');
    const endWindow = startWindow.add(1, 'day');
    const startTs = startWindow.unix();
    const endTs = endWindow.unix();

    const bhs = await BusinessHour.findAll({ where: { doc: doctor_id, clin: location_id }, raw: true });
    const blocks = await Block.findAll({ where: { doc: doctor_id, active: 1, [Op.or]: [ { start_ts: { [Op.between]: [startTs, endTs] } }, { end_ts: { [Op.between]: [startTs, endTs] } }, { start_ts: { [Op.lte]: startTs }, end_ts: { [Op.gte]: endTs } } ] }, raw: true });
    const apps = await Appointment.findAll({ where: { doc: doctor_id, cli: location_id, active: 1, [Op.or]: [ { start_ts: { [Op.between]: [startTs, endTs] } }, { end_ts: { [Op.between]: [startTs, endTs] } }, { start_ts: { [Op.lte]: startTs }, end_ts: { [Op.gte]: endTs } } ] }, raw: true });

    const taken = apps.map(a => [Number(a.start_ts), Number(a.end_ts)]);
    const blocked = blocks.map(b => [Number(b.start_ts), Number(b.end_ts)]);

    const out = [];
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
        const conflict = taken.some(([s, e]) => overlaps(slotStart, slotEnd, s, e)) || blocked.some(([s, e]) => overlaps(slotStart, slotEnd, s, e));
        if (!conflict) out.push({ start_ts: slotStart, end_ts: slotEnd });
        cur = cur.add(slotMinutes, 'minute');
      }
    }

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

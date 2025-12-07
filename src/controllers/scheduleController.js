import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { Op } from 'sequelize';
import { WpPostmeta, BusinessHour, Appointment, WpUser, WpUsermeta } from '../models/index.js';

dayjs.extend(utc);

const dowShort = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dowName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseHours(hh) {
  if (!hh) return null; // "09:00-14:00"
  const [s, e] = String(hh).split('-');
  if (!s || !e) return null;
  return { start: s.trim(), end: e.trim() };
}

function toTs(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0) / 1000);
}

// GET /schedules?clinic_id=99&days=14
export const getSchedules = async (req, res) => {
  try {
    const clinic_id = String(req.query.clinic_id || '');
    const days = Number(req.query.days || 14);
    if (!/^\d+$/.test(clinic_id)) return res.status(400).json({ error: 'invalid_clinic_id' });
    if (!Number.isFinite(days) || days < 1 || days > 60) return res.status(400).json({ error: 'invalid_days' });

    const metas = await WpPostmeta.findAll({
      where: { post_id: Number(clinic_id), meta_key: { [Op.in]: ['cn_open_days', 'cn_am_hours', 'cn_pm_hours'] } },
      raw: true
    });
    const M = Object.fromEntries(metas.map(m => [m.meta_key, String(m.meta_value || '')]));
    const open = (M['cn_open_days'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const am = parseHours(M['cn_am_hours'] || '');
    const pm = parseHours(M['cn_pm_hours'] || '');

    const out = [];
    const start = dayjs().utc().startOf('day');
    for (let d = 0; d < days; d++) {
      const day = start.add(d, 'day');
      const short = dowShort[day.day()];
      if (!open.includes(short)) continue;
      const shifts = [];
      if (am) shifts.push('AM');
      if (pm) shifts.push('PM');
      if (shifts.length) out.push({ date: day.format('YYYY-MM-DD'), weekday: short, shifts });
    }
    return res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'internal_error' });
  }
};

// Helper to compute next free slot and capacity for a doctor
function nextSlotAndCapacity(apps, overlapStart, overlapEnd, slotSec = 40 * 60) {
  const busy = apps.map(a => [Number(a.start_ts), Number(a.end_ts)]).sort((a, b) => a[0] - b[0]);
  let cursor = overlapStart;
  let capacity = 0;
  let next = null;
  for (const [bs, be] of busy) {
    if (be <= cursor) continue;
    while (bs - cursor >= slotSec) {
      if (next === null) next = cursor;
      capacity++;
      cursor += slotSec;
    }
    cursor = Math.max(cursor, be);
    if (cursor >= overlapEnd) break;
  }
  while (overlapEnd - cursor >= slotSec) {
    if (next === null) next = cursor;
    capacity++;
    cursor += slotSec;
  }
  return { next, capacity };
}

// GET /doctors/available?clinic_id=99&date=YYYY-MM-DD&shift=AM
export const getAvailableDoctors = async (req, res) => {
  try {
    const clinic_id = String(req.query.clinic_id || '');
    const date = String(req.query.date || '');
    const shift = String(req.query.shift || '');
    if (!/^\d+$/.test(clinic_id)) return res.status(400).json({ error: 'invalid_clinic_id' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'invalid_date' });
    if (!['AM', 'PM'].includes(shift)) return res.status(400).json({ error: 'invalid_shift' });

    const metas = await WpPostmeta.findAll({ where: { post_id: Number(clinic_id), meta_key: { [Op.in]: ['cn_open_days', 'cn_am_hours', 'cn_pm_hours'] } }, raw: true });
    const M = Object.fromEntries(metas.map(m => [m.meta_key, String(m.meta_value || '')]));
    const open = (M['cn_open_days'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const hours = parseHours(M[shift === 'AM' ? 'cn_am_hours' : 'cn_pm_hours'] || '');
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const short = dowShort[dow];
    if (!open.includes(short) || !hours) return res.json([]);

    const turnoStart = toTs(date, hours.start);
    const turnoEnd = toTs(date, hours.end);

    // Doctors with businesshours in clinic that day
    const dayName = dowName[dow];
    const bh = await BusinessHour.findAll({ where: { clin: String(clinic_id), day: dayName }, raw: true });
    const byDoc = new Map();
    for (const row of bh) {
      if (!byDoc.has(row.doc)) byDoc.set(row.doc, []);
      byDoc.get(row.doc).push(row);
    }
    const docIds = Array.from(byDoc.keys());
    if (docIds.length === 0) return res.json([]);

    // Filter by capability (must be "doctor")
    // meta_value LIKE '%"doctor";b:1%'
    const activeDocs = await WpUsermeta.findAll({
      where: {
        user_id: { [Op.in]: docIds.map(Number) },
        meta_value: { [Op.like]: '%"doctor";b:1%' }
      },
      attributes: ['user_id'],
      raw: true
    });
    const activeDocIds = activeDocs.map(d => String(d.user_id));

    // intersect docIds with activeDocIds
    const finalDocIds = docIds.filter(id => activeDocIds.includes(String(id)));

    if (finalDocIds.length === 0) return res.json([]);

    // Load names
    const users = await WpUser.findAll({ where: { ID: { [Op.in]: finalDocIds.map(Number) } }, raw: true });
    const nameMap = Object.fromEntries(users.map(u => [String(u.ID), u.display_name || u.user_login]));

    // Load all appointments for these doctors that day (active)
    const dayStart = toTs(date, '00:00');
    const dayEnd = dayStart + 86400;
    const appts = await Appointment.findAll({ where: { doc: { [Op.in]: finalDocIds.map(Number) }, cli: Number(clinic_id), active: 1, start_ts: { [Op.lt]: dayEnd }, end_ts: { [Op.gt]: dayStart } }, raw: true });
    const appsByDoc = new Map();
    for (const a of appts) {
      const key = String(a.doc);
      if (!appsByDoc.has(key)) appsByDoc.set(key, []);
      appsByDoc.get(key).push(a);
    }

    const out = [];
    for (const docId of finalDocIds) {
      const rows = byDoc.get(docId) || [];
      let bestNext = null;
      let totalCap = 0;
      for (const r of rows) {
        const s = Math.max(toTs(date, r.start), turnoStart);
        const e = Math.min(toTs(date, r.end), turnoEnd);
        if (e <= s) continue;
        const { next, capacity } = nextSlotAndCapacity(appsByDoc.get(String(docId)) || [], s, e, 40 * 60);
        if (capacity > 0) {
          totalCap += capacity;
          if (bestNext === null || (next !== null && next < bestNext)) bestNext = next;
        }
      }
      if (totalCap > 0) {
        out.push({ id: Number(docId), name: nameMap[String(docId)] || `Doctor ${docId}`, next_available_at: bestNext, capacity_remaining: totalCap });
      }
    }

    out.sort((a, b) => (a.next_available_at || 0) - (b.next_available_at || 0));
    return res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'internal_error' });
  }
};

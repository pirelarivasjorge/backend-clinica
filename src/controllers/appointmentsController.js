import { sequelize, Appointment, Log, Notification, WpPostmeta, BusinessHour } from '../models/index.js';
import { Op, QueryTypes } from 'sequelize';

export const addAppointment = async (req, res) => {
  try {
    const { appid, start_ts, end_ts, price, cli, doc, treat, pat, date, shift } = req.body || {};

    const n = (v) => Number(v);
    const isInt = (v) => Number.isInteger(n(v)) && n(v) >= 0;

    // Modo "por turno": si faltan start/end pero hay date+shift, asignar próximo hueco de 40m
    if ((!start_ts || !end_ts) && cli && doc && pat && date && shift) {
      const slotMinutes = 40;

      // Metas de la clínica
      const metas = await WpPostmeta.findAll({
        where: { post_id: Number(cli), meta_key: { [Op.in]: ['cn_open_days', 'cn_am_hours', 'cn_pm_hours'] } },
        raw: true
      });
      const M = Object.fromEntries(metas.map(m => [m.meta_key, String(m.meta_value || '')]));
      const open = (M['cn_open_days'] || '').split(',').map(s => s.trim()).filter(Boolean);
      const turnoStr = shift === 'AM' ? String(M['cn_am_hours'] || '') : String(M['cn_pm_hours'] || '');
      const dowShort = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      if (!open.includes(dowShort[dow]) || !turnoStr) return res.status(409).json({ error: 'turn_closed' });
      const [tStartStr, tEndStr] = turnoStr.split('-');
      const toTs = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(`${date}T00:00:00Z`); return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0) / 1000); };
      const turnoStart = toTs(tStartStr), turnoEnd = toTs(tEndStr);

      // Horario del médico (businesshours)
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const bhRows = await BusinessHour.findAll({ where: { doc: Number(doc), clin: String(cli), day: dayNames[dow] }, raw: true });
      if (!bhRows.length) return res.status(409).json({ error: 'doctor_not_in_turn' });

      const overlaps = [];
      for (const bh of bhRows) {
        const s = Math.max(toTs(bh.start), turnoStart);
        const e = Math.min(toTs(bh.end), turnoEnd);
        if (e > s) overlaps.push([s, e]);
      }
      if (!overlaps.length) return res.status(409).json({ error: 'no_overlap' });

      // Citas existentes ese día
      const dayStart = toTs('00:00');
      const dayEnd = dayStart + 86400;
      const apps = await Appointment.findAll({ where: { doc: Number(doc), cli: Number(cli), active: 1, start_ts: { [Op.lt]: dayEnd }, end_ts: { [Op.gt]: dayStart } }, raw: true });
      const busy = apps.map(a => [Number(a.start_ts), Number(a.end_ts)]).sort((a, b) => a[0] - b[0]);
      const slotSec = slotMinutes * 60;
      const findSlot = (busyArr, range) => {
        let cursor = range[0];
        for (const [bs, be] of busyArr) {
          if (be <= cursor) continue;
          if (bs - cursor >= slotSec) return cursor;
          cursor = Math.max(cursor, be);
          if (cursor >= range[1]) return null;
        }
        return (range[1] - cursor >= slotSec) ? cursor : null;
      };
      let chosen = null;
      for (const rng of overlaps) { const s = findSlot(busy, rng); if (s) { chosen = s; break; } }
      if (!chosen) return res.status(409).json({ error: 'no_free_slot' });
      const chosenEnd = chosen + slotSec;

      // LOCK para evitar doble reserva
      const lockKey = `cn:${cli}:${date}:${shift}:${doc}`;
      const dialect = (sequelize.getDialect && sequelize.getDialect()) || (sequelize.options && sequelize.options.dialect) || 'unknown';
      let got = 0;
      if (dialect === 'mysql') {
        const [lockRow] = await sequelize.query('SELECT GET_LOCK(?, 5) AS got', { replacements: [lockKey] });
        got = Array.isArray(lockRow) ? lockRow[0]?.got : lockRow?.got;
      } else if (dialect === 'postgres') {
        // Use pg_try_advisory_lock on hash of the key (hashtext returns int4)
        const rows = await sequelize.query('SELECT pg_try_advisory_lock(hashtext(?)) AS got', { replacements: [lockKey], type: QueryTypes.SELECT });
        // rows may be array or object depending on driver
        if (Array.isArray(rows)) {
          got = rows[0] && (rows[0].got === true || rows[0].got === 't') ? 1 : 0;
        } else if (rows && typeof rows.got !== 'undefined') {
          got = (rows.got === true || rows.got === 't') ? 1 : 0;
        }
      } else {
        // Fallback: try MySQL-style, but may fail
        try {
          const [lockRow] = await sequelize.query('SELECT GET_LOCK(?, 5) AS got', { replacements: [lockKey] });
          got = Array.isArray(lockRow) ? lockRow[0]?.got : lockRow?.got;
        } catch (e) {
          console.warn('[DB] unable to acquire lock using dialect', dialect, e.message);
          got = 1; // allow through to attempt reservation (best-effort)
        }
      }
      if (got !== 1 && got !== '1') return res.status(423).json({ error: 'busy' });
      try {
        const overlap = await Appointment.findOne({ where: { doc: Number(doc), cli: Number(cli), active: 1, [Op.not]: { [Op.or]: [{ end_ts: { [Op.lte]: chosen } }, { start_ts: { [Op.gte]: chosenEnd } }] } }, raw: true });
        if (overlap) return res.status(409).json({ error: 'overlap' });
        // appid incremental (dialect-agnostic)
        let appidVal = appid || null;
        if (!appidVal) {
          const maxAppid = await Appointment.max('appid');
          appidVal = Number(maxAppid || 0) + 1;
        }
        // Ensure unique primary ID in DBs without proper serial/sequence defaults
        let nextId = await Appointment.max('ID');
        nextId = Number(nextId || 0) + 1;
        const rec = await Appointment.create({ ID: nextId, appid: appidVal, start_ts: chosen, end_ts: chosenEnd, price: price ? n(price) : 0, cli: Number(cli), clin: '', app_datetime: new Date(), doc: Number(doc), docn: '', treat: treat ? n(treat) : 0, treatn: '', pat: Number(pat), patn: '', paid: 0, active: 1, parent: 0 });
        try {
          await Log.create({ msg: 'appointment_created', uid: pat, data: JSON.stringify({ appointment_id: rec.ID, doc, cli, start_ts: chosen, end_ts: chosenEnd }) });
          await Notification.create({ itemid: rec.ID, type: 'appointment_created', not_datetime: new Date(), availto: JSON.stringify(['doctor', 'patient']), availtoid: JSON.stringify([Number(doc), Number(pat)]), readby: JSON.stringify([]), data: JSON.stringify({ cli, start_ts: chosen, end_ts: chosenEnd }) });
        } catch { }
        return res.status(201).json({ id: rec.ID, start_ts: chosen, end_ts: chosenEnd });
      } finally {
        try {
          if (dialect === 'mysql') {
            await sequelize.query('SELECT RELEASE_LOCK(?)', { replacements: [lockKey] }).catch(() => { });
          } else if (dialect === 'postgres') {
            await sequelize.query('SELECT pg_advisory_unlock(hashtext(?))', { replacements: [lockKey] }).catch(() => { });
          } else {
            // best-effort: try MySQL release
            await sequelize.query('SELECT RELEASE_LOCK(?)', { replacements: [lockKey] }).catch(() => { });
          }
        } catch (_) { }
      }
    }

    // Modo antiguo: requiere start_ts/end_ts explícitos (validamos 40m máx)
    if (!start_ts || !end_ts || !cli || !doc || !pat) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (!isInt(start_ts) || !isInt(end_ts) || n(start_ts) >= n(end_ts)) {
      return res.status(400).json({ error: 'invalid_times' });
    }
    if (!isInt(cli) || !isInt(doc) || !isInt(pat)) {
      return res.status(400).json({ error: 'invalid_ids' });
    }
    if (price !== undefined && !(Number.isFinite(n(price)) && n(price) >= 0)) {
      return res.status(400).json({ error: 'invalid_price' });
    }
    if (n(end_ts) - n(start_ts) > 40 * 60) {
      return res.status(400).json({ error: 'duration_exceeds_40m' });
    }

    const overlap = await Appointment.findOne({
      where: { doc: n(doc), cli: n(cli), active: 1, [Op.not]: { [Op.or]: [{ end_ts: { [Op.lte]: n(start_ts) } }, { start_ts: { [Op.gte]: n(end_ts) } }] } },
      raw: true
    });
    if (overlap) return res.status(409).json({ error: 'overlap' });

    let appidVal = appid || null;
    if (!appidVal) {
      const maxAppid = await Appointment.max('appid');
      appidVal = Number(maxAppid || 0) + 1;
    }

    // Ensure unique primary ID when DB doesn't provide serial defaults
    let nextId2 = await Appointment.max('ID');
    nextId2 = Number(nextId2 || 0) + 1;
    const rec = await Appointment.create({
      ID: nextId2,
      appid: appidVal,
      start_ts: n(start_ts),
      end_ts: n(end_ts),
      price: price ? n(price) : 0,
      cli: n(cli),
      clin: '',
      app_datetime: new Date(),
      doc: n(doc),
      docn: '',
      treat: treat ? n(treat) : 0,
      treatn: '',
      pat: n(pat),
      patn: '',
      paid: 0, active: 1, parent: 0
    });
    try {
      await Log.create({ msg: 'appointment_created', uid: pat, data: JSON.stringify({ appointment_id: rec.ID, doc, cli, start_ts, end_ts }) });
      await Notification.create({ itemid: rec.ID, type: 'appointment_created', not_datetime: new Date(), availto: JSON.stringify(['doctor', 'patient']), availtoid: JSON.stringify([Number(doc), Number(pat)]), readby: JSON.stringify([]), data: JSON.stringify({ cli, start_ts, end_ts }) });
    } catch { }
    return res.status(201).json({ id: rec.ID, start_ts: n(start_ts), end_ts: n(end_ts) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

export const deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const appt = await Appointment.findByPk(id);
    if (!appt) return res.status(404).json({ error: 'not_found' });

    await appt.update({ active: 0 });

    await Log.create({ msg: 'appointment_deleted', uid: appt.pat, data: JSON.stringify({ appointment_id: appt.ID }) });
    await Notification.create({
      itemid: appt.ID,
      type: 'appointment_deleted',
      not_datetime: new Date(),
      availto: JSON.stringify(['doctor', 'patient']),
      availtoid: JSON.stringify([Number(appt.doc), Number(appt.pat)]),
      readby: JSON.stringify([]),
      data: JSON.stringify({ cli: appt.cli })
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

export const cancelByPhone = async (req, res) => {
  try {
    const { phone, appointment_id } = req.body || {};
    console.log('[cancelByPhone] Request received:', { phone, appointment_id });

    if (!phone || !appointment_id) {
      console.log('[cancelByPhone] Missing fields');
      return res.status(400).json({ error: 'missing_fields', details: 'Phone and appointment_id are required' });
    }

    const { WpUsermeta } = await import('../models/index.js');
    // Normalize phone like other controllers (only digits)
    const normalizedPhone = String(phone).replace(/\D+/g, '');
    console.log('[cancelByPhone] Normalized phone:', normalizedPhone);

    if (normalizedPhone.length < 6 || normalizedPhone.length > 20) {
      console.log('[cancelByPhone] Invalid phone length:', normalizedPhone.length);
      return res.status(400).json({ error: 'invalid_phone', details: `Phone length ${normalizedPhone.length} not in range 6-20` });
    }

    // Search for patient with exact match
    let userMeta = await WpUsermeta.findOne({
      where: { meta_key: 'mobile', meta_value: normalizedPhone },
      raw: true
    });

    // If not found, try variations (with/without leading 0, with country code)
    if (!userMeta) {
      console.log('[cancelByPhone] Exact match not found, trying variations...');

      // Try without leading 0 if it starts with 0
      if (normalizedPhone.startsWith('0')) {
        const withoutLeadingZero = normalizedPhone.substring(1);
        userMeta = await WpUsermeta.findOne({
          where: { meta_key: 'mobile', meta_value: withoutLeadingZero },
          raw: true
        });
        console.log('[cancelByPhone] Tried without leading 0:', withoutLeadingZero, userMeta ? 'FOUND' : 'NOT FOUND');
      }

      // Try with leading 0 if it doesn't start with 0
      if (!userMeta && !normalizedPhone.startsWith('0')) {
        const withLeadingZero = '0' + normalizedPhone;
        userMeta = await WpUsermeta.findOne({
          where: { meta_key: 'mobile', meta_value: withLeadingZero },
          raw: true
        });
        console.log('[cancelByPhone] Tried with leading 0:', withLeadingZero, userMeta ? 'FOUND' : 'NOT FOUND');
      }

      // Try with Venezuelan country code +58
      if (!userMeta) {
        const withCountryCode = '58' + (normalizedPhone.startsWith('0') ? normalizedPhone.substring(1) : normalizedPhone);
        userMeta = await WpUsermeta.findOne({
          where: { meta_key: 'mobile', meta_value: withCountryCode },
          raw: true
        });
        console.log('[cancelByPhone] Tried with country code:', withCountryCode, userMeta ? 'FOUND' : 'NOT FOUND');
      }
    }

    if (!userMeta) {
      console.log('[cancelByPhone] Patient not found for phone:', normalizedPhone);
      return res.status(404).json({
        error: 'patient_not_found',
        details: `No patient found with phone ${normalizedPhone} or its variations`
      });
    }

    console.log('[cancelByPhone] Patient found:', userMeta.user_id);

    const appt = await Appointment.findOne({
      where: { ID: Number(appointment_id), pat: userMeta.user_id, active: 1 },
      raw: true
    });

    if (!appt) {
      console.log('[cancelByPhone] Appointment not found or not active');

      // Check if appointment exists but is inactive
      const inactiveAppt = await Appointment.findOne({
        where: { ID: Number(appointment_id), pat: userMeta.user_id, active: 0 },
        raw: true
      });

      if (inactiveAppt) {
        console.log('[cancelByPhone] Appointment already cancelled');
        return res.status(400).json({
          error: 'appointment_already_cancelled',
          details: 'This appointment has already been cancelled'
        });
      }

      // Check if appointment belongs to different patient
      const otherAppt = await Appointment.findOne({
        where: { ID: Number(appointment_id) },
        raw: true
      });

      if (otherAppt) {
        console.log('[cancelByPhone] Appointment belongs to different patient');
        return res.status(403).json({
          error: 'appointment_not_yours',
          details: 'This appointment does not belong to the provided phone number'
        });
      }

      console.log('[cancelByPhone] Appointment does not exist');
      return res.status(404).json({
        error: 'appointment_not_found',
        details: `No active appointment found with ID ${appointment_id} for this patient`
      });
    }

    console.log('[cancelByPhone] Cancelling appointment:', appt.ID);
    await Appointment.update({ active: 0 }, { where: { ID: appt.ID } });

    await Log.create({ msg: 'appointment_canceled_by_phone', uid: appt.pat, data: JSON.stringify({ appointment_id: appt.ID, phone }) });
    await Notification.create({
      itemid: appt.ID,
      type: 'appointment_canceled',
      not_datetime: new Date(),
      availto: JSON.stringify(['doctor', 'patient']),
      availtoid: JSON.stringify([Number(appt.doc), Number(appt.pat)]),
      readby: JSON.stringify([]),
      data: JSON.stringify({ cli: appt.cli, phone })
    });

    console.log('[cancelByPhone] Success');
    res.json({ ok: true, message: 'Appointment cancelled successfully' });
  } catch (err) {
    console.error('[cancelByPhone] Error:', err);
    res.status(500).json({ error: 'internal_error', details: err.message });
  }
};

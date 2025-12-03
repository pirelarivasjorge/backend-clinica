import { Op } from 'sequelize';
import dayjs from 'dayjs';
import { sequelize, WpUser, WpUsermeta, Appointment } from '../models/index.js';

export const getPatientByPhone = async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'missing_phone' });
    const normalized = String(phone).replace(/\D+/g, '');
    if (normalized.length < 6 || normalized.length > 20) {
      return res.status(400).json({ error: 'invalid_phone' });
    }

    // Try 'mobile' first; optionally billing_phone
    const metaKeys = ['mobile', 'billing_phone'];

    // Find usermeta with matching phone
    const um = await WpUsermeta.findOne({
      where: {
        meta_key: { [Op.in]: metaKeys },
        meta_value: normalized
      },
      raw: true
    });

    if (!um) return res.json({ exists: false });

    const user = await WpUser.findByPk(um.user_id, { raw: true });
    return res.json({ exists: !!user, user: user ? {
      id: user.ID,
      name: user.display_name,
      email: user.user_email
    } : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

export const upsertPatient = async (req, res) => {
  try {
    const { phone, first_name = '', last_name = '', email = '' } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'missing_phone' });
    const normalized = String(phone).replace(/\D+/g, '');
    if (normalized.length < 6 || normalized.length > 20) {
      return res.status(400).json({ error: 'invalid_phone' });
    }

    let created = false;
    let userId = null;
    let displayNameOut = '';

    await sequelize.transaction(async (t) => {
      // Find existing by mobile
      let um = await WpUsermeta.findOne({ where: { meta_key: 'mobile', meta_value: normalized }, transaction: t, lock: t.LOCK.UPDATE, raw: true });
      let user;
      if (um) {
        user = await WpUser.findByPk(um.user_id, { transaction: t });
        if (!user) throw new Error('user_meta_orphan');
        const display_name = [first_name, last_name].filter(Boolean).join(' ').trim() || user.display_name;
        await user.update({
          user_login: user.user_login || `wa_${normalized}`,
          user_email: email || user.user_email || '',
          display_name
        }, { transaction: t });
        await WpUsermeta.upsert({ user_id: user.ID, meta_key: 'first_name', meta_value: first_name }, { transaction: t });
        await WpUsermeta.upsert({ user_id: user.ID, meta_key: 'last_name', meta_value: last_name }, { transaction: t });
        userId = Number(user.ID);
        displayNameOut = user.display_name;
        created = false;
      } else {
        // Create new WP user with explicit ID to support DBs without AUTO_INCREMENT
        const [rows] = await sequelize.query('SELECT IFNULL(MAX(ID),0)+1 AS next FROM `7xoht3agf_users`', { transaction: t });
        const nextId = Number((rows && rows[0] && rows[0].next) || 1);
        const display_name = [first_name, last_name].filter(Boolean).join(' ').trim() || `WA ${normalized}`;
        user = await WpUser.create({
          ID: nextId,
          user_login: `wa_${normalized}`,
          user_email: email || '',
          display_name
        }, { transaction: t });
        const idVal = Number(user?.ID || nextId);
        await WpUsermeta.create({ user_id: idVal, meta_key: 'mobile', meta_value: normalized }, { transaction: t });
        await WpUsermeta.create({ user_id: idVal, meta_key: 'first_name', meta_value: first_name }, { transaction: t });
        await WpUsermeta.create({ user_id: idVal, meta_key: 'last_name', meta_value: last_name }, { transaction: t });
        await WpUsermeta.create({ user_id: idVal, meta_key: '7xoht3agf_capabilities', meta_value: 'a:1:{s:7:"patient";b:1;}' }, { transaction: t });
        await WpUsermeta.create({ user_id: idVal, meta_key: '7xoht3agf_user_level', meta_value: '0' }, { transaction: t });
        userId = idVal;
        displayNameOut = display_name;
        created = true;
      }
    });

    return res.status(200).json({ id: userId, exists: !created, name: displayNameOut });
  } catch (err) {
    console.error(err);
    if (err && err.message === 'user_meta_orphan') {
      return res.status(500).json({ error: 'user_meta_orphan' });
    }
    res.status(500).json({ error: 'internal_error' });
  }
};

export const getPatientAppointments = async (req, res) => {
  try {
    const { phone } = req.query;
    const only_upcoming = String(req.query.only_upcoming || '1') === '1';
    if (!phone) return res.status(400).json({ error: 'missing_phone' });
    const normalized = String(phone).replace(/\D+/g, '');
    if (normalized.length < 6 || normalized.length > 20) {
      return res.status(400).json({ error: 'invalid_phone' });
    }

    const um = await WpUsermeta.findOne({ where: { meta_key: 'mobile', meta_value: normalized }, raw: true });
    if (!um) return res.json([]);

    const nowTs = Math.floor(Date.now() / 1000);
    const where = { pat: um.user_id, active: 1 };
    if (only_upcoming) where.start_ts = { [Op.gte]: nowTs };

    const apps = await Appointment.findAll({ where, order: [['start_ts', 'ASC']], raw: true });
    res.json(apps.map(a => ({ id: a.ID, doctor_id: a.doc, location_id: a.cli, start_ts: a.start_ts, end_ts: a.end_ts })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

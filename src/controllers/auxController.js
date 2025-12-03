import { Op } from 'sequelize';
import { WpUser, WpUsermeta, WpPost, WpPostmeta, Log } from '../models/index.js';

export const searchDoctors = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const rows = await WpUser.findAll({
      attributes: ['ID', 'display_name'],
      include: [{
        model: WpUsermeta, as: 'caps', required: true,
        where: { meta_key: '7xoht3agf_capabilities', meta_value: { [Op.like]: '%"doctor";b:1%' } }, attributes: []
      }],
      where: { display_name: { [Op.like]: `%${q}%` } },
      limit: 20,
      raw: true
    });
    res.json(rows.map(r => ({ id: r.ID, name: r.display_name })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

export const getTreatments = async (req, res) => {
  try {
    // Optional clinic filter: ?clinic_id=123
    const clinicId = req.query.clinic_id || req.query.clin || req.query.location_id || null;
    if (clinicId) {
      // find postmeta for that clinic that lists treatments (comma-separated ids)
      const pm = await WpPostmeta.findOne({ where: { post_id: Number(clinicId), meta_key: 'treatments' }, raw: true });
      if (!pm || !pm.meta_value) return res.json([]);
      const ids = String(pm.meta_value).split(',').map(s => Number(s.trim())).filter(Boolean);
      if (!ids.length) return res.json([]);
      const rows = await WpPost.findAll({ where: { ID: ids, post_type: 'treatment', post_status: 'publish' }, attributes: ['ID', 'post_title'], raw: true });
      return res.json(rows.map(r => ({ id: r.ID, name: r.post_title })));
    }

    // Basic listing of CPT 'treatment' (no clinic filter)
    const rows = await WpPost.findAll({ where: { post_type: 'treatment', post_status: 'publish' }, attributes: ['ID', 'post_title'], raw: true });
    res.json(rows.map(r => ({ id: r.ID, name: r.post_title })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

export const addLog = async (req, res) => {
  try {
    const { phone, event, data } = req.body || {};
    let uid = 0;
    if (phone) {
      const normalized = String(phone).replace(/\D+/g, '');
      const um = await WpUsermeta.findOne({ where: { meta_key: 'mobile', meta_value: normalized }, raw: true });
      if (um) uid = Number(um.user_id);
    }
await Log.create({ msg: event || 'bot_event', uid, data: JSON.stringify(data || {}) });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

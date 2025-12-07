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
    // Filters: ?id_location=99 & ?id_doctor=123
    const locId = req.query.id_location || req.query.clinic_id || req.query.clin || req.query.location_id || null;
    const docId = req.query.id_doctor || null;

    let allowedIds = null; // null means "all allowed" so far

    // 1. Filter by Location (using postmeta 'treatments')
    if (locId) {
      const pm = await WpPostmeta.findOne({ where: { post_id: Number(locId), meta_key: 'treatments' }, raw: true });
      if (!pm || !pm.meta_value) return res.json([]);
      const locTreats = String(pm.meta_value).split(',').map(s => Number(s.trim())).filter(Boolean);
      allowedIds = locTreats;
    }

    // 2. Filter by Doctor (using usermeta 'treatments')
    if (docId) {
      const um = await WpUsermeta.findOne({ where: { user_id: Number(docId), meta_key: 'treatments' }, raw: true });
      if (!um || !um.meta_value) return res.json([]);
      const docTreats = String(um.meta_value).split(',').map(s => Number(s.trim())).filter(Boolean);

      if (allowedIds === null) {
        allowedIds = docTreats;
      } else {
        // Intersect
        allowedIds = allowedIds.filter(id => docTreats.includes(id));
      }
    }

    // If we have filters but no matching IDs
    if (allowedIds !== null && allowedIds.length === 0) return res.json([]);

    // Query WpPost
    const whereClause = { post_type: 'treatment', post_status: 'publish' };
    if (allowedIds !== null) {
      whereClause.ID = allowedIds;
    }

    const rows = await WpPost.findAll({ where: whereClause, attributes: ['ID', 'post_title'], raw: true });
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

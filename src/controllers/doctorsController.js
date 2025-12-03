import { Op, fn, col, where, literal } from 'sequelize';
import { WpUser, WpUsermeta, BusinessHour } from '../models/index.js';

export const getDoctors = async (req, res) => {
  try {
    const { location_id } = req.query;

    if (location_id !== undefined && String(location_id).trim() !== '' && !/^\d+$/.test(String(location_id))) {
      return res.status(400).json({ error: 'invalid_location_id' });
    }

    // Users with role doctor
    const doctors = await WpUser.findAll({
      attributes: ['ID', 'display_name'],
      include: [{
        model: WpUsermeta,
        as: 'caps',
        required: true,
        where: { meta_key: '7xoht3agf_capabilities', meta_value: { [Op.like]: '%"doctor";b:1%' } },
        attributes: []
      }],
      raw: true
    });

    let data = doctors.map(d => ({ id: d.ID, name: d.display_name }));

    if (location_id) {
      // Filter by BusinessHour clin == location_id (stored as text)
      const bhDocs = await BusinessHour.findAll({
        attributes: ['doc'],
        where: { clin: String(location_id) },
        group: ['doc'],
        raw: true
      });
      const allowed = new Set(bhDocs.map(x => String(x.doc)));
      data = data.filter(d => allowed.has(String(d.id)));
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

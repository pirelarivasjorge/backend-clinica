import { WpPost } from '../models/index.js';

export const getLocations = async (req, res) => {
  try {
    const rows = await WpPost.findAll({
      where: { post_type: 'clinic', post_status: 'publish' },
      attributes: ['ID', 'post_title']
    });
    const data = rows.map(r => ({ id: r.ID, name: r.post_title }));
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

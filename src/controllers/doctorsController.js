import { Op, fn, col, where, literal, QueryTypes } from 'sequelize';
import { WpUser, WpUsermeta, BusinessHour, sequelize } from '../models/index.js';

export const getDoctors = async (req, res) => {
  try {
    const { location_id } = req.query;

    if (location_id !== undefined && String(location_id).trim() !== '' && !/^\d+$/.test(String(location_id))) {
      return res.status(400).json({ error: 'invalid_location_id' });
    }

    // Build and run a combined query: users who have doctor capability
    // and optionally are present in businesshours for the given location
    const capabilityPattern = '%"doctor";b:1%';

    if (location_id) {
      const sql = `
        SELECT u."ID", u."display_name"
        FROM "7xoht3agf_users" AS u
        WHERE u."ID" IN (
          SELECT m."user_id" FROM "7xoht3agf_usermeta" AS m
          WHERE m."meta_value" LIKE :capability
        ) AND u."ID" IN (
          SELECT doc FROM "businesshours" bh WHERE bh."clin" = :loc
        )
      `;

      const rows = await sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { capability: capabilityPattern, loc: String(location_id) }
      });

      const data = rows.map(r => ({ id: r.ID, name: r.display_name }));
      return res.json(data);
    } else {
      // No location filter: return all users with doctor capability
      const sql = `
        SELECT u."ID", u."display_name"
        FROM "7xoht3agf_users" AS u
        WHERE u."ID" IN (
          SELECT m."user_id" FROM "7xoht3agf_usermeta" AS m
          WHERE m."meta_value" LIKE :capability
        )
      `;

      const rows = await sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { capability: capabilityPattern }
      });

      const data = rows.map(r => ({ id: r.ID, name: r.display_name }));
      return res.json(data);
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

export const getDoctorsByTreatment = async (req, res) => {
  try {
    const { treatment_id } = req.query;

    if (!treatment_id || !/^\d+$/.test(treatment_id)) {
      return res.status(400).json({ error: 'invalid_treatment_id' });
    }

    const sql = `
      SELECT 
        d."ID" AS doctor_id,
        d."post_title" AS doctor_name
      FROM 
        "7xoht3agf_posts" AS d
      INNER JOIN 
        "7xoht3agf_postmeta" AS pm 
        ON d."ID" = pm."post_id"
      WHERE 
        d."post_type" = 'doctor' 
        AND d."post_status" = 'publish'
        AND pm."meta_key" = 'treatments'
        AND (
            pm."meta_value" = :tid 
            OR pm."meta_value" LIKE :pattern1 
            OR pm."meta_value" LIKE :pattern2 
            OR pm."meta_value" LIKE :pattern3
        )
    `;

    const rows = await sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements: {
        tid: treatment_id,
        pattern1: `%,${treatment_id},%`,
        pattern2: `${treatment_id},%`,
        pattern3: `%,${treatment_id}`
      }
    });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
};

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { sequelize } from './models/index.js';

const app = express();

// Public CORS (allow all origins)
app.use(cors({ origin: true, credentials: false }));
app.options('*', cors());

app.use(express.json());

// Base path like in WP
app.use('/wp-json/appointments/v1', routes);

// Public health endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB connection established');
    app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on http://0.0.0.0:${PORT}`));
  } catch (err) {
    console.error('DB connection error:', err);
    process.exit(1);
  }
})();

import { Sequelize } from 'sequelize';
import { format } from 'sql-formatter';

const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  MODE_ENV
} = process.env;

const logSql = (msg) => {
  try {
    // Filtrar solo sentencias SQL reales (ignorando comandos internos o no parseables)
    if (!msg.startsWith('Executing')) return console.log(`\n[Sequelize]: ${msg}`);

    const cleanMsg = msg.replace(/^Executing \(.*?\): /, '');
    const formatted = format(cleanMsg, { language: 'postgresql' });
    console.log(`\n[Consulta]:\n${formatted}`);
  } catch (err) {
    console.warn('\n[Sequelize:raw]', msg); // fallback sin formatear
  }
};

// Build connection URI from individual env vars: postgres://user:pass@host:port/dbname
const user = encodeURIComponent(DB_USER || '');
const pass = encodeURIComponent(DB_PASSWORD || '');
const host = DB_HOST || 'localhost';
const port = DB_PORT || '5432';
const dbName = DB_NAME || '';

const connectionUri = `postgres://${user}:${pass}@${host}:${port}/${dbName}`;

const sequelize = new Sequelize(connectionUri, {
  dialect: 'postgres',
  logging: MODE_ENV === 'development' ? logSql : false,
  define: {
    freezeTableName: true,
    timestamps: false
  }
});

export { sequelize };

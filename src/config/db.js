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
    const formatted = format(cleanMsg, { language: 'mysql' });
    console.log(`\n[Consulta]:\n${formatted}`);
  } catch (err) {
    console.warn('\n[Sequelize:raw]', msg); // fallback sin formatear
  }
};

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: Number(DB_PORT),
  dialect: 'mysql',
  logging: MODE_ENV === 'development' ? logSql : false,
  define: {
    freezeTableName: true,
    timestamps: false
  }
});

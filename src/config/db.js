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

const { DATABASE_URL } = process.env;

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

// Allow using a single DATABASE_URL env var (preferred) or individual parts as fallback
let sequelize;
if (DATABASE_URL) {
  sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: MODE_ENV === 'development' ? logSql : false,
    define: {
      freezeTableName: true,
      timestamps: false
    }
  });
} else {
  sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: Number(DB_PORT),
    dialect: 'postgres',
    logging: MODE_ENV === 'development' ? logSql : false,
    define: {
      freezeTableName: true,
      timestamps: false
    }
  });
}

export { sequelize };

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
  try {
    // Try direct initialization with the full DATABASE_URL
    sequelize = new Sequelize(DATABASE_URL, {
      dialect: 'postgres',
      logging: MODE_ENV === 'development' ? logSql : false,
      define: {
        freezeTableName: true,
        timestamps: false
      }
    });
  } catch (initErr) {
    // Fallback: parse DATABASE_URL manually and initialize with separate params
    console.warn('[DB] direct DATABASE_URL init failed, parsing manually:', initErr.message);
    try {
      const parsed = new URL(DATABASE_URL);
      const parsedDbName = parsed.pathname ? parsed.pathname.replace(/^\//, '') : DB_NAME;
      const parsedUser = parsed.username || DB_USER;
      const parsedPass = parsed.password || DB_PASSWORD;
      const parsedHost = parsed.hostname || DB_HOST;
      const parsedPort = parsed.port ? Number(parsed.port) : Number(DB_PORT);

      sequelize = new Sequelize(parsedDbName, parsedUser, parsedPass, {
        host: parsedHost,
        port: parsedPort,
        dialect: 'postgres',
        logging: MODE_ENV === 'development' ? logSql : false,
        define: {
          freezeTableName: true,
          timestamps: false
        }
      });
    } catch (parseErr) {
      // Re-throw original error for visibility if parsing also fails
      console.error('[DB] failed to parse DATABASE_URL:', parseErr.message);
      throw initErr;
    }
  }
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

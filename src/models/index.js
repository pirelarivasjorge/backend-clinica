export * from '../config/db.js';

import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Core tables
export const Appointment = sequelize.define('appointments', {
  ID: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  appid: DataTypes.BIGINT,
  start_ts: DataTypes.BIGINT,
  end_ts: DataTypes.BIGINT,
  price: DataTypes.DECIMAL(10,2),
  cli: DataTypes.BIGINT,
  app_datetime: DataTypes.DATE,
  doc: DataTypes.BIGINT,
  treat: DataTypes.BIGINT,
  pat: DataTypes.BIGINT,
  docn: DataTypes.TEXT,
  patn: DataTypes.TEXT,
  treatn: DataTypes.TEXT,
  clin: DataTypes.TEXT,
  paid: DataTypes.SMALLINT,
  active: DataTypes.SMALLINT,
  parent: DataTypes.INTEGER
}, { tableName: 'appointments' });

export const Block = sequelize.define('blocks', {
  ID: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  blockid: DataTypes.BIGINT,
  start_ts: DataTypes.BIGINT,
  end_ts: DataTypes.BIGINT,
  block_datetime: DataTypes.DATE,
  doc: DataTypes.STRING(55),
  reason: DataTypes.TEXT,
  active: DataTypes.SMALLINT
}, { tableName: 'blocks' });

export const BusinessHour = sequelize.define('businesshours', {
  ID: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  start: DataTypes.TEXT,
  end: DataTypes.TEXT,
  day: DataTypes.TEXT,
  doc: DataTypes.BIGINT,
  docn: DataTypes.TEXT,
  clin: DataTypes.TEXT,
  uid: DataTypes.INTEGER
}, { tableName: 'businesshours' });

export const Payment = sequelize.define('payments', {
  ID: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  pid: DataTypes.BIGINT,
  type: DataTypes.STRING(20),
  amount: DataTypes.DECIMAL(10,2),
  pay_datetime: DataTypes.DATE,
  doc: DataTypes.BIGINT,
  treat: DataTypes.TEXT,
  pat: DataTypes.BIGINT,
  docn: DataTypes.TEXT,
  patn: DataTypes.TEXT,
  treatn: DataTypes.TEXT,
  typen: DataTypes.TEXT,
  uid: DataTypes.BIGINT,
  active: DataTypes.SMALLINT
}, { tableName: 'payments' });

export const Log = sequelize.define('logs', {
  ID: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  msg: DataTypes.STRING(255),
  uid: DataTypes.BIGINT,
  created: DataTypes.DATE,
  data: DataTypes.TEXT
}, { tableName: 'logs' });

export const Notification = sequelize.define('notifications', {
  ID: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  itemid: DataTypes.BIGINT,
  type: DataTypes.STRING(20),
  not_datetime: DataTypes.DATE,
  availto: DataTypes.TEXT,
  availtoid: DataTypes.TEXT,
  readby: DataTypes.TEXT,
  data: DataTypes.TEXT
}, { tableName: 'notifications' });

// WordPress tables (minimal fields used by endpoints)
export const WpPost = sequelize.define('7xoht3agf_posts', {
  ID: { type: DataTypes.BIGINT, primaryKey: true },
  post_title: DataTypes.TEXT,
  post_status: DataTypes.STRING(20),
  post_type: DataTypes.STRING(20)
}, { tableName: '7xoht3agf_posts' });

export const WpPostmeta = sequelize.define('7xoht3agf_postmeta', {
  meta_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  post_id: DataTypes.BIGINT,
  meta_key: DataTypes.STRING(255),
  meta_value: DataTypes.TEXT
}, { tableName: '7xoht3agf_postmeta' });

export const WpUser = sequelize.define('7xoht3agf_users', {
  ID: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_login: DataTypes.STRING,
  user_email: DataTypes.STRING,
  display_name: DataTypes.STRING
}, { tableName: '7xoht3agf_users' });

export const WpUsermeta = sequelize.define('7xoht3agf_usermeta', {
  umeta_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_id: DataTypes.BIGINT,
  meta_key: DataTypes.STRING(255),
  meta_value: DataTypes.TEXT
}, { tableName: '7xoht3agf_usermeta' });

// Associations used in queries
WpUser.hasMany(WpUsermeta, { foreignKey: 'user_id', as: 'meta' });
WpUser.hasMany(WpUsermeta, { foreignKey: 'user_id', as: 'caps' });
WpUsermeta.belongsTo(WpUser, { foreignKey: 'user_id', as: 'user' });

import pg from 'pg';

const { Pool } = pg;

export function createPool(env = process.env) {
  return new Pool({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}

const pool = createPool();

export default pool;

'use strict';

const { Pool } = require('pg'); //Pool manages multiple PostgreSQL connections efficiently, instead of opening/closing one connection per query.
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'finops_db',
  user: process.env.DB_USER || 'finops_user',
  password: process.env.DB_PASS,
  max: 20,
  idleTimeoutMillis: 30000, //How long a client can stay idle in the pool (30s)
  connectionTimeoutMillis: 2000, //Max wait time for acquiring a connection (2s)
});

pool.on('connect', () => logger.debug('New PostgreSQL client connected'));
pool.on('error', (err) => logger.error('PostgreSQL pool error:', err));


async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 60)}...`);
    return result;
  } catch (error) {
    logger.error('Database query error:', { text, error: error.message });
    throw error;
  }
}


async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { query, transaction, pool };

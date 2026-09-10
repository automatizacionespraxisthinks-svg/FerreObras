const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
module.exports = {
  query: (text, params) => pool.query(text, params),
  tx: async (fn) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },
};

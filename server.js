import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import logger from './logger.js';

const app = express();

app.use(cors());
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

app.get('/api/Clientes/activos', async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(process.env.DB_CONN);
    const result = await pool.request().query('SELECT Identificador, Cliente FROM Clientes WHERE Activo = 1 ORDER BY Cliente');
    res.json(result.recordset);
  } catch (err) {
    logger.error(`Database query failed: ${err.message}`);
    res.status(500).json({ error: 'Database query failed' });
  } finally {
    if (pool) await pool.close();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
});
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import sql from 'mssql';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// API Key opcional
const API_KEY = process.env.API_KEY || null;
app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.header('x-api-key') !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// Config MSSQL desde ENV
const sqlConfig = {
  server: process.env.MSSQL_SERVER,
  port: process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : 1433,
  database: process.env.MSSQL_DATABASE,
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  options: {
    encrypt: String(process.env.MSSQL_ENCRYPT) === 'true',
    trustServerCertificate: String(process.env.MSSQL_TRUST_SERVER_CERTIFICATE) === 'true'
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let poolPromise = null;
async function getPool() {
  try {
    if (!poolPromise) {
      if (!sqlConfig.server || !sqlConfig.database || !sqlConfig.user || !sqlConfig.password) {
        return null; // Modo mock si faltan ENV
      }
      poolPromise = sql.connect(sqlConfig);
    }
    return await poolPromise;
  } catch (e) {
    console.error('MSSQL connect error:', e);
    poolPromise = null;
    return null;
  }
}

// Ruta para pruebas de salud
app.get('/health', async (req, res) => {
  try {
    const pool = await getPool();
    res.json({ ok: true, dbConnected: !!pool });
  } catch {
    res.json({ ok: true, dbConnected: false });
  }
});

// Endpoint clientes
app.get('/api/clientes', async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) {
      return res.json([
        { id: 1, cliente: 'Acme' },
        { id: 2, cliente: 'Globex' }
      ]);
    }
    const result = await pool.request().query(`
      SELECT Identificador AS id, Cliente AS cliente
      FROM Clientes
      WHERE Activo = 1
      ORDER BY Cliente
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /api/clientes error:', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API up and running on port ${PORT}`);
});
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

// LOTES por cabina
app.get('/api/lotes/:cabina', async (req, res) => {
    try {
        const cabina = req.params.cabina;
        const pool = await getPool();
        if (!pool) {
            // Mock sin DB
            return res.json([
                { IdLote: 101, Cabina: cabina, Estado: 'Programado', ProgramadoPara: '2025-08-12 09:00' },
                { IdLote: 102, Cabina: cabina, Estado: 'En curso', ProgramadoPara: '2025-08-12 10:00' }
            ]);
        }
        const r = await pool.request()
            .input('cabina', sql.VarChar, cabina)
            .query(`
        SELECT IdLote, Cabina, Estado, ProgramadoPara
        FROM Lotes
        WHERE Cabina = @cabina
        ORDER BY ProgramadoPara DESC
      `);
        res.json(r.recordset);
    } catch (err) {
        console.error('GET /api/lotes error:', err);
        res.status(500).json({ error: 'db_error' });
    }
});

// Registrar PESAJE
app.post('/api/pesajes', async (req, res) => {
    try {
        const { lote, peso } = req.body || {};
        if (!lote || typeof peso !== 'number') {
            return res.status(400).json({ error: 'bad_request' });
        }
        const pool = await getPool();
        if (!pool) {
            // Mock sin DB
            return res.status(201).json({ ok: true, id: Date.now(), lote, peso });
        }
        const r = await pool.request()
            .input('lote', sql.Int, lote)
            .input('peso', sql.Decimal(18, 3), peso)
            .query(`
        INSERT INTO Pesajes (IdLote, Peso)
        OUTPUT INSERTED.Id AS id
        VALUES (@lote, @peso)
      `);
        res.status(201).json({ ok: true, ...r.recordset[0] });
    } catch (err) {
        console.error('POST /api/pesajes error:', err);
        res.status(500).json({ error: 'db_error' });
    }
});

// (Opcional) listar pesajes por lote
app.get('/api/pesajes', async (req, res) => {
    try {
        const { lote } = req.query;
        const pool = await getPool();
        if (!pool) {
            return res.json([{ Id: 1, IdLote: Number(lote) || 101, Peso: 12.345, Fecha: '2025-08-12T09:15:00Z' }]);
        }
        const r = await pool.request()
            .input('lote', sql.Int, Number(lote) || 0)
            .query(`
        SELECT Id, IdLote, Peso, Fecha
        FROM Pesajes
        ${lote ? 'WHERE IdLote = @lote' : ''}
        ORDER BY Fecha DESC
      `);
        res.json(r.recordset);
    } catch (err) {
        console.error('GET /api/pesajes error:', err);
        res.status(500).json({ error: 'db_error' });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API up and running on port ${PORT}`);
});
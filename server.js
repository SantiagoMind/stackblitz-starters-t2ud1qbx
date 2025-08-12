// server.js (ESM)
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import morgan from 'morgan';
import sql from 'mssql';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 10000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('dev'));

// Configuración SQL
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,   // ej: "mi-servidor,1433" si lleva puerto
    database: process.env.DB_NAME,
    options: {
        encrypt: false,
        enableArithAbort: true
    }
};

// Pool global
let poolPromise;
async function getPool() {
    if (!poolPromise) poolPromise = sql.connect(dbConfig);
    return poolPromise;
}

// Helper de queries
async function runQuery(res, query, params = {}) {
    try {
        const pool = await getPool();
        const request = pool.request();
        for (const k of Object.keys(params)) request.input(k, params[k]);
        const result = await request.query(query);
        return res.json(result.recordset ?? []);
    } catch (err) {
        console.error('SQL error:', err);
        return res.status(500).json({ error: 'db_error', detail: String(err.message || err) });
    }
}

// ---------- RUTAS ---------- //

// Salud
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// LOGIN
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    const query = `
    SELECT * FROM Usuarios
    WHERE Usuario = @username AND Contrasena = @password
  `;
    await runQuery(res, query, { username, password });
});

// CLIENTES
app.get('/api/clientes', async (_req, res) => {
    await runQuery(res, 'SELECT * FROM Clientes');
});

// INGREDIENTES
app.get('/api/ingredientes', async (_req, res) => {
    await runQuery(res, 'SELECT * FROM Ingredientes');
});

// FÓRMULAS
app.get('/api/formulas', async (_req, res) => {
    await runQuery(res, 'SELECT * FROM Formulas');
});

// PRODUCTOS TERMINADOS
app.get('/api/productos-terminados', async (_req, res) => {
    await runQuery(res, 'SELECT * FROM ProductosTerminados');
});

// LOTES
app.get('/api/lotes', async (_req, res) => {
    await runQuery(res, 'SELECT * FROM Lotes');
});

// LOTES PROGRAMADOS
app.get('/api/lotes-programados', async (_req, res) => {
    await runQuery(res, 'SELECT * FROM LotesProgramados');
});

// PESO (Registros de pesado)
app.post('/api/peso', async (req, res) => {
    const { loteId, ingredienteId, peso } = req.body ?? {};
    const query = `
    INSERT INTO Pesos (LoteId, IngredienteId, Peso)
    VALUES (@loteId, @ingredienteId, @peso)
  `;
    await runQuery(res, query, { loteId, ingredienteId, peso });
});

// WEATHER (prueba)
app.get('/api/weather', async (_req, res) => {
    await runQuery(res, 'SELECT TOP 5 * FROM WeatherForecast');
});

// 404
app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

// Start
app.listen(PORT, () => {
    console.log(`✅ API up and running on port ${PORT}`);
});
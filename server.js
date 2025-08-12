// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('dev'));

// Configuración SQL
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: false,
        enableArithAbort: true
    }
};

// Función helper para querys
async function runQuery(res, query, params = {}) {
    try {
        let pool = await sql.connect(dbConfig);
        let request = pool.request();
        for (let key in params) {
            request.input(key, params[key]);
        }
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ---------- RUTAS ---------- //

// LOGIN
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const query = `
        SELECT * FROM Usuarios
        WHERE Usuario = @username AND Contrasena = @password
    `;
    await runQuery(res, query, { username, password });
});

// CLIENTES
app.get('/api/clientes', async (req, res) => {
    const query = `SELECT * FROM Clientes`;
    await runQuery(res, query);
});

// INGREDIENTES
app.get('/api/ingredientes', async (req, res) => {
    const query = `SELECT * FROM Ingredientes`;
    await runQuery(res, query);
});

// FÓRMULAS
app.get('/api/formulas', async (req, res) => {
    const query = `SELECT * FROM Formulas`;
    await runQuery(res, query);
});

// PRODUCTOS TERMINADOS
app.get('/api/productos-terminados', async (req, res) => {
    const query = `SELECT * FROM ProductosTerminados`;
    await runQuery(res, query);
});

// LOTES
app.get('/api/lotes', async (req, res) => {
    const query = `SELECT * FROM Lotes`;
    await runQuery(res, query);
});

// LOTES PROGRAMADOS
app.get('/api/lotes-programados', async (req, res) => {
    const query = `SELECT * FROM LotesProgramados`;
    await runQuery(res, query);
});

// PESO (Registros de pesado)
app.post('/api/peso', async (req, res) => {
    const { loteId, ingredienteId, peso } = req.body;
    const query = `
        INSERT INTO Pesos (LoteId, IngredienteId, Peso)
        VALUES (@loteId, @ingredienteId, @peso)
    `;
    await runQuery(res, query, { loteId, ingredienteId, peso });
});

// WEATHER (prueba de conexión)
app.get('/api/weather', async (req, res) => {
    const query = `SELECT TOP 5 * FROM WeatherForecast`;
    await runQuery(res, query);
});

// ---------- INICIO SERVIDOR ---------- //
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
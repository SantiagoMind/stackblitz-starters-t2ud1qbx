import express from 'express';
import sql from 'mssql';
import fs from 'fs';
import morgan from 'morgan';

import logger from './logger.js';

const app = express();
app.use(express.json());

// HTTP request logging
app.use(
  morgan('combined', {
    stream: {
      write: message => logger.info(message.trim())
    }
  })
);

// Read connection string from existing .NET appsettings.json
let connectionString;
try {
  logger.info('Reading database configuration');
  const config = JSON.parse(fs.readFileSync('appsettings.json', 'utf8'));
  connectionString = config.ConnectionStrings.DefaultConnection;
  logger.debug('Database configuration loaded');
} catch (err) {
  logger.error(`Unable to read database configuration: ${err.message}`);
}

// Example endpoint replicating ClientesController GET /api/clientes/activos
app.get('/api/clientes/activos', async (req, res) => {
  logger.debug('Request to /api/clientes/activos');
  if (!connectionString) {
    logger.error('Database connection not configured');
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    logger.debug('Connecting to SQL Server');
    await sql.connect(connectionString);
    const result = await sql.query`SELECT Identificador, Cliente FROM Clientes WHERE Activo = 1 ORDER BY Cliente`;
    logger.info(`Fetched ${result.recordset.length} active clientes`);
    const formatted = result.recordset.map(row => ({
      identificador: row.Identificador,
      cliente: row.Cliente
    }));
    res.json(formatted);
  } catch (err) {
    logger.error(`Error querying database: ${err.message}`);
    res.status(500).json({ error: 'Error querying database' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Global error handlers
process.on('unhandledRejection', err => {
  logger.error(`Unhandled rejection: ${err.message}`);
});

process.on('uncaughtException', err => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

sql.on('error', err => {
  logger.error(`SQL error: ${err.message}`);
});
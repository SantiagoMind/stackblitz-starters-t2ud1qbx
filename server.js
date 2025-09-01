// server.js — API consolidada (monolito) para Render (ESM, Node 18+)

import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import sql from 'mssql';

// -------------------- App & Middlewares --------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// API Key opcional por header x-api-key
const API_KEY = process.env.API_KEY || null;
app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.header('x-api-key') !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// -------------------- MSSQL Pool --------------------
const sqlConfig = {
  server: process.env.MSSQL_SERVER,
  port: process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : 1433,
  database: process.env.MSSQL_DATABASE,
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  options: {
    encrypt: String(process.env.MSSQL_ENCRYPT) === 'true',
    trustServerCertificate: String(process.env.MSSQL_TRUST_SERVER_CERTIFICATE) === 'true',
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise = null;
async function getPool() {
  try {
    if (!poolPromise) {
      if (!sqlConfig.server || !sqlConfig.database || !sqlConfig.user || !sqlConfig.password) {
        return null; // Modo MOCK si faltan ENV
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

function asyncHandler(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(`${req.method} ${req.path} error:`, err);
    res.status(500).json({ error: 'server_error', detalle: err?.message });
  });
}

// -------------------- Health --------------------
app.get('/health', asyncHandler(async (req, res) => {
  const pool = await getPool();
  res.json({ ok: true, dbConnected: !!pool });
}));

// ============================================================
// ===============  CLIENTES (ClientesController)  ============
// ============================================================
app.get('/api/Clientes/activos', asyncHandler(async (req, res) => {
  const pool = await getPool();
  if (!pool) {
    return res.json([
      { identificador: 1, cliente: 'Acme' },
      { identificador: 2, cliente: 'Globex' },
    ]);
  }
  const r = await pool.request().query(`
    SELECT Identificador AS identificador, Cliente AS cliente
    FROM Clientes
    WHERE Activo = 1
    ORDER BY Cliente;
  `);
  res.json(r.recordset);
}));

// ============================================================
// ============  INGREDIENTES (IngredientesController)  =======
// ============================================================
app.get('/api/Ingredientes/categorias', asyncHandler(async (req, res) => {
  const pool = await getPool();
  if (!pool) return res.json([{ Id: 1, Nombre: 'Base' }]);
  const r = await pool.request().query(`
    SELECT Identificador AS Id, ISNULL(Categoria, '') AS Nombre
    FROM CategoriasIngredientes
    WHERE Activo = 1;
  `);
  res.json(r.recordset);
}));

app.get('/api/Ingredientes/proveedores', asyncHandler(async (req, res) => {
  const pool = await getPool();
  if (!pool) return res.json([{ Id: 1, Nombre: 'Proveedor Demo' }]);
  const r = await pool.request().query(`
    SELECT Identificador AS Id, Proveedor AS Nombre
    FROM ProveedoresIngredientes
    WHERE Activo = 1;
  `);
  res.json(r.recordset);
}));

app.get('/api/Ingredientes/listado', asyncHandler(async (req, res) => {
  const { nombre = null, categoriaId = null, estado = null } = req.query;
  const pool = await getPool();
  if (!pool) {
    return res.json([{
      Id: 1, Nombre: 'Azúcar', Activo: 1, Categoria: 'Dulces', Descripcion: 'Refinado'
    }]);
  }
  const request = pool.request()
    .input('nombre', sql.NVarChar, nombre ? String(nombre) : null)
    .input('nombreLike', sql.NVarChar, nombre ? `%${String(nombre)}%` : null)
    .input('categoriaId', sql.Int, categoriaId ? Number(categoriaId) : null)
    .input('estado', sql.VarChar, estado ? String(estado) : null);
  const r = await request.query(`
    SELECT 
      I.Identificador AS Id,
      I.Ingrediente  AS Nombre,
      CAST(I.Activo AS INT) AS Activo,
      ISNULL(C.Categoria, '') AS Categoria,
      ISNULL(I.Descripcion, '') AS Descripcion
    FROM Ingredientes I
    LEFT JOIN CategoriasIngredientes C ON I.CategoriaID = C.Identificador
    WHERE 1=1
      AND (@nombre IS NULL OR I.Ingrediente LIKE @nombreLike)
      AND (@categoriaId IS NULL OR I.CategoriaID = @categoriaId)
      AND (
          @estado IS NULL
          OR (@estado = 'activo' AND I.Activo = 1)
          OR (@estado = 'inactivo' AND I.Activo = 0)
      )
  `);
  res.json(r.recordset);
}));

app.post('/api/Ingredientes/nuevo', asyncHandler(async (req, res) => {
  const data = req.body || {};
  const { Nombre, Descripcion = '', CategoriaId, Activo } = data;
  if (!Nombre || (CategoriaId == null) || (Activo == null)) {
    return res.status(400).json({ mensaje: 'Solicitud inválida' });
  }

  const pool = await getPool();
  if (!pool) {
    return res.status(201).json({ mensaje: 'Ingrediente registrado correctamente', id: Date.now() });
  }

  const dup = await pool.request()
    .input('nombre', sql.NVarChar, Nombre)
    .query(`SELECT COUNT(*) AS c FROM Ingredientes WHERE Ingrediente = @nombre;`);
  if (dup.recordset[0].c > 0) {
    return res.status(409).json({ mensaje: 'Ya existe un ingrediente con ese nombre.' });
  }

  const r = await pool.request()
    .input('nombre', sql.NVarChar, Nombre)
    .input('activo', sql.Int, Number(Activo))
    .input('categoriaId', sql.Int, Number(CategoriaId))
    .input('descripcion', sql.NVarChar, Descripcion ?? '')
    .query(`
      INSERT INTO Ingredientes (Ingrediente, Activo, CategoriaID, Descripcion)
      VALUES (@nombre, @activo, @categoriaId, @descripcion);
      SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
    `);
  return res.status(201).json({ mensaje: 'Ingrediente registrado correctamente', id: r.recordset[0].id });
}));

app.put('/api/Ingredientes/actualizar/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const data = req.body || {};
  const { Nombre, Descripcion = '', CategoriaId, Activo } = data;

  const pool = await getPool();
  if (!pool) return res.json({ mensaje: 'Ingrediente actualizado correctamente' });

  const dup = await pool.request()
    .input('nombre', sql.NVarChar, Nombre)
    .input('id', sql.Int, id)
    .query(`SELECT COUNT(*) AS c FROM Ingredientes WHERE Ingrediente = @nombre AND Identificador != @id;`);
  if (dup.recordset[0].c > 0) {
    return res.status(409).json({ mensaje: 'Ya existe otro ingrediente con ese nombre.' });
  }

  await pool.request()
    .input('nombre', sql.NVarChar, Nombre)
    .input('activo', sql.Int, Number(Activo))
    .input('categoriaId', sql.Int, Number(CategoriaId))
    .input('descripcion', sql.NVarChar, Descripcion ?? '')
    .input('id', sql.Int, id)
    .query(`
      UPDATE Ingredientes
      SET Ingrediente = @nombre,
          Activo = @activo,
          CategoriaID = @categoriaId,
          Descripcion = @descripcion
      WHERE Identificador = @id;
    `);
  res.json({ mensaje: 'Ingrediente actualizado correctamente' });
}));

app.get('/api/Ingredientes/activos', asyncHandler(async (req, res) => {
  const pool = await getPool();
  if (!pool) {
    return res.json([{ Clave: '1', Nombre: 'Azúcar', Descripcion: '' }]);
  }
  const r = await pool.request().query(`
    SELECT 
      CAST(Identificador AS NVARCHAR(50)) AS Clave,
      Ingrediente AS Nombre,
      ISNULL(Descripcion, '') AS Descripcion
    FROM Ingredientes
    WHERE Activo = 1
    ORDER BY Ingrediente;
  `);
  res.json(r.recordset);
}));

// ============================================================
// ====================  FORMULAS (FormulasController) ========
// ============================================================
app.get('/api/Formulas/activas', asyncHandler(async (req, res) => {
  const pool = await getPool();
  if (!pool) return res.json([{ nombre: 'PT-001' }, { nombre: 'PT-002' }]);
  const r = await pool.request().query(`
    SELECT CodigoProducto AS nombre
    FROM ProductosTerminados
    WHERE Activo = 1
    ORDER BY CodigoProducto COLLATE Latin1_General_CI_AS;
  `);
  res.json(r.recordset);
}));

// ============================================================
// ======================= LOTES (LotesController) ============
// ============================================================
app.post('/api/lotes/programar', asyncHandler(async (req, res) => {
  const { FormulaId, Fecha, Cantidad, Peso, UsuarioProgramo } = req.body || {};
  if (!FormulaId || !Fecha || !Cantidad || !Peso) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const pool = await getPool();
  if (!pool) return res.status(201).json({ mensaje: '✅ Lotes programados correctamente.' });

  await pool.request()
    .input('CodigoProducto', sql.NVarChar, String(FormulaId))
    .input('FechaProgramada', sql.DateTime, new Date(Fecha))
    .input('UsuarioProgramo', sql.NVarChar, UsuarioProgramo ? String(UsuarioProgramo) : 'usuarioWeb')
    .input('CantidadLotes', sql.Int, Number(Cantidad))
    .input('PesoPorLote', sql.Decimal(18, 3), Number(Peso))
    .execute('SP_ProgramarLotesProduccion');
  res.status(201).json({ mensaje: '✅ Lotes programados correctamente.' });
}));

// ============================================================
// ============ LOTES PROGRAMADOS (LotesProgramadosController) =
// ============================================================
app.get('/lotesprogramados', asyncHandler(async (req, res) => {
  const { inicio, fin } = req.query;
  if (!inicio || !fin) return res.status(400).json({ error: 'params_required' });

  const pool = await getPool();
  if (!pool) {
    return res.json([{
      Consecutivo: 123, Lote: 'LOT-001', Producto: 'PT-001', PesoLote: 25, LineadeMezclado: 1, FechaProgramada: new Date().toISOString()
    }]);
  }

  const r = await pool.request()
    .input('inicio', sql.DateTime, new Date(String(inicio)))
    .input('fin', sql.DateTime, new Date(String(fin)))
    .query(`
      SELECT 
        a.Consecutivo,
        a.ID_Lot AS Lote,
        a.Producto,
        a.PesoLote,
        b.LineadeMezclado,
        b.FechaProgramada
      FROM ProgramacionProduccion a
      LEFT JOIN ProgramacionProduccion_Control b ON a.Consecutivo = b.Consecutivo 
      WHERE CAST(FechaProgramada AS DATE) BETWEEN @inicio AND @fin
        AND ISNULL(b.LoteCompletado, 0) = 0
        AND ISNULL(a.Cancelado, 0) = 0
      ORDER BY Consecutivo;
    `);
  res.json(r.recordset);
}));

app.get('/unidadesdemedida/activas', asyncHandler(async (req, res) => {
  const pool = await getPool();
  if (!pool) return res.json([
    { Identificador: 1, UnidaddeMedida: 'Kilogramos', Abreviatura: 'kg' },
    { Identificador: 2, UnidaddeMedida: 'Gramos',     Abreviatura: 'g'  },
    { Identificador: 3, UnidaddeMedida: 'Libras',     Abreviatura: 'lb' }
  ]);

  const rows = await pool.request().query(`
    SELECT Identificador, UnidaddeMedida, Abreviatura
    FROM dbo.UnidadesDeMedida
    WHERE Activo = 1
    ORDER BY Identificador
  `);
  res.json(rows.recordset || []);
}));

// POST /lotesprogramados/programar (con unidad de medida)
app.post('/lotesprogramados/programar', asyncHandler(async (req, res) => {
  const {
    CodigoProducto,
    FechaProgramada,
    UsuarioProgramo,
    CantidadLotes,
    PesoPorLote,
    UnidadMedidaId,
    IdUnidadMedida
  } = req.body || {};

  const unidadId = Number(UnidadMedidaId ?? IdUnidadMedida);

  if (!CodigoProducto || !FechaProgramada || !UsuarioProgramo ||
      !CantidadLotes || !PesoPorLote || !Number.isFinite(unidadId) || unidadId <= 0) {
    return res.status(400).json({ mensaje: '❌ Error al programar', detalle: 'Parámetros incompletos o inválidos' });
  }

  const pool = await getPool();
  if (!pool) {
    return res.status(201).json({ mensaje: '✅ Lotes programados correctamente (sin pool)' });
  }

  const um = await pool.request()
    .input('Id', sql.Int, unidadId)
    .query(`
      SELECT 1
      FROM dbo.UnidadesDeMedida
      WHERE Activo = 1 AND Identificador = @Id
    `);
  if ((um.recordset || []).length === 0) {
    return res.status(400).json({ mensaje: '❌ Unidad de medida inválida o inactiva' });
  }

  await pool.request()
    .input('CodigoProducto',  sql.NVarChar, String(CodigoProducto))
    .input('FechaProgramada', sql.DateTime, new Date(FechaProgramada))
    .input('UsuarioProgramo', sql.NVarChar, String(UsuarioProgramo))
    .input('CantidadLotes',   sql.Int,      parseInt(CantidadLotes, 10))
    .input('PesoPorLote',     sql.Decimal(18, 3), Number(PesoPorLote))
    .input('IdUnidadMedida',  sql.Int,      unidadId)
    .execute('SP_ProgramarLotesProduccion');

  res.status(201).json({ mensaje: '✅ Lotes programados correctamente' });
}));

// GET /lotesprogramados/detallelote?consecutivo=... → { detalle, maxSecuencia }
app.get('/lotesprogramados/detallelote', asyncHandler(async (req, res) => {
  const consecutivo = req.query.consecutivo ? Number(req.query.consecutivo) : null;
  if (!consecutivo) return res.status(400).json({ error: 'consecutivo_required' });

  const pool = await getPool();
  if (!pool) {
    return res.json({
      detalle: {
        Consecutivo: consecutivo,
        ProductoTerminado: 'PT-001',
        LotePT: 'LOT-001',
        Ingrediente: '1',
        NombreIngrediente: 'Azúcar; Refinado',
        PesoProgramado: 10.5,
        Porcentaje: 0.42,
        Secuencia: 1,
        DescripcionPT: 'Producto demo'
      },
      maxSecuencia: 5
    });
  }

  const det = await pool.request()
    .input('Consecutivo', sql.BigInt, consecutivo)
    .query(`
      SELECT TOP 1 
          a.Consecutivo,
          a.Producto AS ProductoTerminado,
          a.ID_Lot AS LotePT,
          c.Ingrediente,
          i.Ingrediente + '; ' + ISNULL(i.Descripcion, '') AS NombreIngrediente,
          c.PesoProgramado,
          c.Porcentaje,
          c.Secuencia,
          pt.Descripcion AS DescripcionPT
      FROM ProgramacionProduccion a
      LEFT JOIN ProgramacionProduccion_Control b ON a.Consecutivo = b.Consecutivo
      LEFT JOIN ProgramacionProduccion_Detalle c ON a.Consecutivo = c.Consecutivo
      LEFT JOIN Ingredientes i ON c.Ingrediente = i.Identificador
      LEFT JOIN ProductosTerminados pt ON a.Producto = pt.CodigoProducto
      WHERE a.Consecutivo = @Consecutivo
        AND c.TiempoDePesado IS NULL
      ORDER BY c.Secuencia;
    `);

  const max = await pool.request()
    .input('Consecutivo', sql.BigInt, consecutivo)
    .query(`SELECT MAX(Secuencia) AS maxSecuencia FROM ProgramacionProduccion_Detalle WHERE Consecutivo = @Consecutivo;`);

  res.json({
    detalle: det.recordset[0] || null,
    maxSecuencia: max.recordset[0]?.maxSecuencia ?? 0
  });
}));

// POST /lotesprogramados/eliminar → { eliminados, rowsAffected }
app.post('/lotesprogramados/eliminar', asyncHandler(async (req, res) => {
  const consecutivos = Array.isArray(req.body?.consecutivos) ? req.body.consecutivos : [];
  const ids = [...new Set(consecutivos.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return res.status(400).json({ mensaje: 'consecutivos_required' });

  const pool = await getPool();
  if (!pool) return res.json({ eliminados: ids.length, rowsAffected: [0], mock: true });

  const reqDb = pool.request();
  const names = ids.map((id, i) => { const nm = `id${i}`; reqDb.input(nm, sql.BigInt, id); return `@${nm}`; });
  const inList = names.join(',');

  const q = `
    UPDATE ProgramacionProduccion SET Cancelado = 1 WHERE Consecutivo IN (${inList});
  `;
  const r = await reqDb.query(q);
  res.json({ eliminados: ids.length, rowsAffected: r.rowsAffected });
}));

// DELETE /lotesprogramados/:consecutivo → { ok: true }
app.delete('/lotesprogramados/:consecutivo', asyncHandler(async (req, res) => {
  const consecutivo = Number(req.params.consecutivo);
  if (!Number.isInteger(consecutivo) || consecutivo <= 0) {
    return res.status(400).json({ mensaje: 'consecutivo_required' });
  }

  const pool = await getPool();
  if (!pool) return res.json({ ok: true, rowsAffected: [0], mock: true });

  const r = await pool.request()
    .input('id', sql.BigInt, consecutivo)
    .query(`
      UPDATE ProgramacionProduccion SET Cancelado = 1 WHERE Consecutivo = @id;
    `);

  res.json({ ok: true, rowsAffected: r.rowsAffected });
}));

// POST /lotesprogramados/eliminar-rango → { eliminados }
app.post('/lotesprogramados/eliminar-rango', asyncHandler(async (req, res) => {
  const inicioRaw = req.body?.inicio || req.query?.inicio;
  const finRaw = req.body?.fin || req.query?.fin;
  if (!inicioRaw || !finRaw) {
    return res.status(400).json({ mensaje: 'inicio_fin_required' });
  }
  const inicio = new Date(String(inicioRaw));
  const fin = new Date(String(finRaw));
  if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) {
    return res.status(400).json({ mensaje: 'invalid_dates' });
  }

  const pool = await getPool();
  if (!pool) return res.json({ eliminados: 0, mock: true });

  const r = await pool.request()
    .input('inicio', sql.DateTime, inicio)
    .input('fin', sql.DateTime, fin)
    .query(`
      UPDATE a
      SET a.Cancelado = 1
      FROM ProgramacionProduccion a
      INNER JOIN ProgramacionProduccion_Control b ON a.Consecutivo = b.Consecutivo
      WHERE CAST(b.FechaProgramada AS DATE) BETWEEN @inicio AND @fin
        AND ISNULL(b.LoteCompletado, 0) = 0
        AND b.ProduccionInicio IS NULL
        AND ISNULL(a.Cancelado, 0) = 0;
    `);

  res.json({ eliminados: Array.isArray(r.rowsAffected) ? (r.rowsAffected[0] || 0) : 0 });
}));

// ============================================================
// =================== PESAJE (PesoController) =================
// ============================================================
// POST /peso → registra y devuelve siguiente pendiente
app.post('/peso', asyncHandler(async (req, res) => {
  const {
    Consecutivo,
    ProductoTerminado,
    Secuencia,
    Ingrediente,
    Tara,
    Peso,
    Etiqueta,
    FotoBase64
  } = req.body || {};

  if (
    Consecutivo == null || !ProductoTerminado || Secuencia == null ||
    !Ingrediente || Tara == null || Peso == null
  ) {
    return res.status(400).json({ error: 'bad_request' });
  }

  const pool = await getPool();
  if (!pool) {
    return res.status(201).json({
      ok: true, mensaje: '✅ Peso registrado', remaining: 0, completed: false, next: null, mock: true
    });
  }

  // Foto opcional
  let fotoBytes = null;
  if (FotoBase64) {
    let b64 = String(FotoBase64);
    if (b64.includes(',')) b64 = b64.substring(b64.indexOf(',') + 1);
    try { fotoBytes = Buffer.from(b64, 'base64'); } catch { fotoBytes = null; }
  }

  const tx = new sql.Transaction(await pool);
  await tx.begin();
  try {
    // 1) Actualiza pesado
    const rUpd = await new sql.Request(tx)
      .input('tara', sql.Decimal(18, 12), Number(Tara))
      .input('peso', sql.Decimal(18, 2), Number(Peso))
      .input('etiqueta', sql.NVarChar(299), Etiqueta ?? '')
      .input('consecutivo', sql.BigInt, Number(Consecutivo))
      .input('productoTerminado', sql.NVarChar(40), String(ProductoTerminado).trim())
      .input('secuencia', sql.Int, Number(Secuencia))
      .input('ingrediente', sql.NVarChar(50), String(Ingrediente).trim())
      .input('foto', sql.VarBinary(sql.MAX), fotoBytes ?? null)
      .query(`
        UPDATE ProgramacionProduccion_Detalle
        SET 
            TaraReal = @tara,
            PesoReal = @peso,
            TiempoDePesado = GETDATE(),
            EtiquetaLeida = @etiqueta,
            FotoEscaneo = @foto
        WHERE 
            Consecutivo = @consecutivo AND 
            ProductoTerminado = @productoTerminado AND
            Secuencia = @secuencia AND 
            Ingrediente = @ingrediente;
        SELECT @@ROWCOUNT AS rowsAffected;
      `);

    if (rUpd.recordset[0]?.rowsAffected === 0) {
      await tx.rollback();
      return res.status(404).json({ mensaje: '❌ No se encontró el registro para actualizar.' });
    }

    // 2) Marca inicio si aplica
    if (Number(Secuencia) === 1) {
      await new sql.Request(tx)
        .input('consecutivo', sql.BigInt, Number(Consecutivo))
        .query(`
          UPDATE ProgramacionProduccion_Control
          SET ProduccionInicio = COALESCE(ProduccionInicio, GETDATE())
          WHERE Consecutivo = @consecutivo;
        `);
    }

    // 3) Pendientes
    const rPend = await new sql.Request(tx)
      .input('consecutivo', sql.BigInt, Number(Consecutivo))
      .query(`
        SELECT COUNT(*) AS c
        FROM ProgramacionProduccion_Detalle
        WHERE Consecutivo = @consecutivo AND TiempoDePesado IS NULL;
      `);
    const remaining = rPend.recordset[0]?.c ?? 0;

    // 4) Finaliza lote si no quedan
    let completed = false;
    if (remaining === 0) {
      await new sql.Request(tx)
        .input('consecutivo', sql.BigInt, Number(Consecutivo))
        .query(`
          UPDATE ProgramacionProduccion_Control
          SET ProduccionFinal = GETDATE(), LoteCompletado = 1
          WHERE Consecutivo = @consecutivo;
        `);
      completed = true;
    }

    // 5) Siguiente ingrediente pendiente
    let next = null;
    if (!completed) {
      const rNext = await new sql.Request(tx)
        .input('consecutivo', sql.BigInt, Number(Consecutivo))
        .query(`
          SELECT TOP 1 
              a.Consecutivo,
              a.Producto AS ProductoTerminado,
              a.ID_Lot   AS LotePT,
              c.Ingrediente,
              i.Ingrediente + '; ' + ISNULL(i.Descripcion, '') AS NombreIngrediente,
              c.PesoProgramado,
              c.Porcentaje,
              c.Secuencia
          FROM ProgramacionProduccion a
          LEFT JOIN ProgramacionProduccion_Detalle c ON a.Consecutivo = c.Consecutivo
          LEFT JOIN Ingredientes i ON c.Ingrediente = i.Identificador
          WHERE a.Consecutivo = @consecutivo AND c.TiempoDePesado IS NULL
          ORDER BY c.Secuencia;
        `);
      next = rNext.recordset[0] || null;
    }

    await tx.commit();
    return res.status(201).json({
      ok: true,
      mensaje: '✅ Peso registrado con éxito.',
      remaining,
      completed,
      next
    });
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}));

// ============================================================
// =====  PRODUCTOS TERMINADOS (ProductosTerminadosController) =
// ============================================================
app.post('/api/ProductosTerminados/nuevo', asyncHandler(async (req, res) => {
  const data = req.body || {};
  const { Codigo, Descripcion, ClienteId, NombreCliente, Ingredientes } = data;
  if (!Codigo || !Descripcion || (ClienteId == null) || !NombreCliente || !Array.isArray(Ingredientes)) {
    return res.status(400).json({ mensaje: 'Error al guardar', detalle: 'Parámetros incompletos' });
  }

  const pool = await getPool();
  if (!pool) return res.status(201).json({ mensaje: 'Producto registrado correctamente' });

  const tx = new sql.Transaction(await pool);
  await tx.begin();
  try {
    const reqH = new sql.Request(tx);
    await reqH
      .input('Codigo', sql.NVarChar, Codigo)
      .input('Descripcion', sql.NVarChar, Descripcion)
      .input('ClienteId', sql.Int, Number(ClienteId))
      .input('NombreCliente', sql.NVarChar, NombreCliente)
      .query(`
        INSERT INTO ProductosTerminados (CodigoProducto, Descripcion, Cliente, NombreCliente, FechaCreacion, UsuarioCreador, Activo)
        VALUES (@Codigo, @Descripcion, @ClienteId, @NombreCliente, GETDATE(), 'sistema', 1);
      `);

    let num = 1;
    for (const ing of Ingredientes) {
      const rqd = new sql.Request(tx);
      await rqd
        .input('CodigoProducto', sql.NVarChar, Codigo)
        .input('Num', sql.Int, num++)
        .input('Ingrediente', sql.NVarChar, String(ing.Clave))
        .input('Porcentaje', sql.Decimal(18, 5), String(ing.Porcentaje))
        .input('Comentario', sql.NVarChar, ing.Comentario ?? null)
        .query(`
          INSERT INTO ProductosTerminados_Detalle (CodigoProducto, NumIngrediente, Ingrediente, Porcentaje, Comentario)
          VALUES (@CodigoProducto, @Num, @Ingrediente, @Porcentaje, @Comentario);
        `);
    }

    await tx.commit();
    res.status(201).json({ mensaje: 'Producto registrado correctamente' });
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}));

app.put('/api/ProductosTerminados/editar/:codigo', asyncHandler(async (req, res) => {
  const codigo = String(req.params.codigo);
  const data = req.body || {};
  const { Descripcion, ClienteId, NombreCliente, Activo, Ingredientes } = data;
  if (!Descripcion || (ClienteId == null) || !NombreCliente || typeof Activo !== 'boolean' || !Array.isArray(Ingredientes)) {
    return res.status(400).json({ mensaje: 'Error al actualizar', detalle: 'Parámetros incompletos' });
  }

  const pool = await getPool();
  if (!pool) return res.json({ mensaje: 'Producto actualizado correctamente' });

  const tx = new sql.Transaction(await pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('Codigo', sql.NVarChar, codigo)
      .input('Descripcion', sql.NVarChar, Descripcion)
      .input('ClienteId', sql.Int, Number(ClienteId))
      .input('NombreCliente', sql.NVarChar, NombreCliente)
      .input('Activo', sql.Int, Activo ? 1 : 0)
      .query(`
        UPDATE ProductosTerminados
        SET Descripcion = @Descripcion,
            Cliente = @ClienteId,
            NombreCliente = @NombreCliente,
            Activo = @Activo
        WHERE CodigoProducto = @Codigo;
      `);

    await new sql.Request(tx)
      .input('Codigo', sql.NVarChar, codigo)
      .query(`DELETE FROM ProductosTerminados_Detalle WHERE CodigoProducto = @Codigo;`);

    let num = 1;
    for (const ing of Ingredientes) {
      await new sql.Request(tx)
        .input('CodigoProducto', sql.NVarChar, codigo)
        .input('Num', sql.Int, num++)
        .input('Ingrediente', sql.NVarChar, String(ing.Clave))
        .input('Porcentaje', sql.Decimal(18, 5), String(ing.Porcentaje))
        .input('Comentario', sql.NVarChar, ing.Comentario ?? null)
        .query(`
          INSERT INTO ProductosTerminados_Detalle (CodigoProducto, NumIngrediente, Ingrediente, Porcentaje, Comentario)
          VALUES (@CodigoProducto, @Num, @Ingrediente, @Porcentaje, @Comentario);
        `);
    }

    await tx.commit();
    res.json({ mensaje: 'Producto actualizado correctamente' });
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}));

app.get('/api/ProductosTerminados/listado', asyncHandler(async (req, res) => {
  const { codigo = null, cliente = null, nombreCliente = null, activo = null } = req.query;
  const pool = await getPool();
  if (!pool) {
    return res.json([{
      CodigoProducto: 'PT-001',
      Descripcion: 'Demo',
      NombreCliente: 'Cliente X',
      Cliente: 'Cliente X (tabla)',
      ClienteId: 1,
      FechaCreacion: new Date().toISOString(),
      Activo: 1
    }]);
  }
  const r = await pool.request()
    .input('codigo', sql.NVarChar, codigo ? `%${String(codigo)}%` : null)
    .input('cliente', sql.NVarChar, cliente ? `%${String(cliente)}%` : null)
    .input('nombreCliente', sql.NVarChar, nombreCliente ? `%${String(nombreCliente)}%` : null)
    .input('activo', sql.Int, (activo && String(activo) !== 'todos') ? Number(activo) : null)
    .query(`
      SELECT 
        pt.CodigoProducto AS CodigoProducto, 
        pt.Descripcion AS Descripcion, 
        pt.NombreCliente AS NombreCliente,
        c.Cliente AS Cliente,
        pt.Cliente AS ClienteId,
        pt.FechaCreacion AS FechaCreacion,
        pt.Activo AS Activo
      FROM ProductosTerminados pt
      LEFT JOIN Clientes c ON pt.Cliente = c.Identificador
      WHERE 1=1
        AND (@codigo IS NULL OR pt.CodigoProducto LIKE @codigo)
        AND (@cliente IS NULL OR c.Cliente LIKE @cliente)
        AND (@nombreCliente IS NULL OR pt.NombreCliente LIKE @nombreCliente)
        AND (@activo IS NULL OR pt.Activo = @activo)
    `);
  res.json(r.recordset);
}));

app.get('/api/ProductosTerminados/detalle/:codigo', asyncHandler(async (req, res) => {
  const codigo = String(req.params.codigo);
  const pool = await getPool();
  if (!pool) {
    return res.json([{ Clave: '1', Nombre: 'Azúcar', Porcentaje: '50.00000', Comentario: '' }]);
  }
  const r = await pool.request()
    .input('codigo', sql.NVarChar, codigo)
    .query(`
      SELECT 
        pd.Ingrediente AS Clave,
        i.Ingrediente AS Nombre,
        CONVERT(VARCHAR(32), CONVERT(DECIMAL(18,5), pd.Porcentaje)) AS Porcentaje,
        ISNULL(pd.Comentario, '') AS Comentario
      FROM ProductosTerminados_Detalle pd
      LEFT JOIN Ingredientes i ON pd.Ingrediente = i.Identificador
      WHERE pd.CodigoProducto = @codigo
      ORDER BY pd.NumIngrediente;
    `);
  res.json(r.recordset);
}));

app.get('/api/ProductosTerminados/existecodigo', asyncHandler(async (req, res) => {
  const { codigo } = req.query;
  if (!codigo) return res.status(400).json({ mensaje: 'Error al verificar código' });
  const pool = await getPool();
  if (!pool) return res.json(true);
  const r = await pool.request()
    .input('codigo', sql.NVarChar, String(codigo))
    .query(`SELECT COUNT(*) AS c FROM ProductosTerminados WHERE CodigoProducto = @codigo;`);
  res.json(r.recordset[0].c > 0);
}));

// ============================================================
// ====================== LOGIN (LoginController) =============
// ============================================================
app.post('/login', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const Username = body.Username ?? body.username;
  const Password = body.Password ?? body.password;
  if (!Username || !Password) return res.status(400).json({ error: 'bad_request' });

  const pool = await getPool();
  if (!pool) {
    const ok = Username === 'demo' && Password === 'demo';
    if (!ok) return res.status(401).json({ mensaje: '❌ Usuario o contraseña incorrectos' });
    return res.json({ Nombre: 'Demo', Correo: 'demo@example.com', PlanActivo: true });
  }

  const r = await pool.request()
    .input('username', sql.NVarChar, String(Username))
    .query(`SELECT Nombre, Correo, PasswordHash, PlanActivo FROM Usuarios WHERE Username = @username;`);

  if (!r.recordset.length) {
    return res.status(401).json({ mensaje: '❌ Usuario o contraseña incorrectos' });
  }

  const row = r.recordset[0];
  let bcrypt = null;
  try {
    ({ default: bcrypt } = await import('bcryptjs'));
  } catch (e) {
    return res.status(500).json({
      error: 'server_setup_error',
      detalle: 'bcryptjs no instalado; agréguelo para validar contraseñas'
    });
  }

  const ok = await bcrypt.compare(String(Password), String(row.PasswordHash));
  if (!ok) return res.status(401).json({ mensaje: '❌ Usuario o contraseña incorrectos' });

  res.json({
    Nombre: row.Nombre,
    Correo: row.Correo,
    PlanActivo: !!row.PlanActivo
  });
}));

// -------------------- Inicio servidor -----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API up and running on port ${PORT}`);
});

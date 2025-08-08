import express from 'express';
const app = express();

app.get('/api/clientes', (req, res) => {
  // TODO: trae de MSSQL o devuelve mock al inicio
  res.json([
    { id: 1, cliente: 'Acme' },
    { id: 2, cliente: 'Globex' },
  ]);
});

// MUY IMPORTANTE en StackBlitz:
app.listen(process.env.PORT || 3000, () => {
  console.log('API up');
});

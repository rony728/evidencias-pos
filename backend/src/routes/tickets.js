import { Router } from 'express';
import { getTicket, upsertTicket } from '../services/tickets.js';
import { isUuid, TICKET_SELECT } from '../utils/tickets.js';

function validateId(id) {
  if (!isUuid(id)) throw Object.assign(new Error('El ID no es un UUID válido.'), { status: 400 });
}

async function inTransaction(database, action) {
  const client = typeof database.connect === 'function' ? await database.connect() : database;
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

export function createTicketsRouter(database) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const result = await database.query(`SELECT ${TICKET_SELECT} FROM tickets ORDER BY fecha_modificacion DESC`);
      const deleted = await database.query('SELECT id, fecha_eliminacion AS "fechaEliminacion" FROM tickets_eliminados ORDER BY fecha_eliminacion ASC');
      res.json({ tickets: result.rows, eliminados: deleted.rows });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      validateId(req.params.id);
      const ticket = await getTicket(database, req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Registro no encontrado.' });
      return res.json({ ticket });
    } catch (error) { return next(error); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const result = await inTransaction(database, (client) => upsertTicket(client, req.body));
      res.status(result.applied ? 201 : 200).json(result);
    } catch (error) { next(error); }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      validateId(req.params.id);
      const result = await inTransaction(database, (client) => upsertTicket(client, { ...req.body, id: req.params.id }));
      res.json(result);
    } catch (error) { next(error); }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      validateId(req.params.id);
      const deletionDate = req.body?.fechaEliminacion || new Date().toISOString();
      if (Number.isNaN(Date.parse(deletionDate))) throw Object.assign(new Error('Fecha de eliminación no válida.'), { status: 400 });
      await inTransaction(database, async (client) => {
        await client.query(`
          INSERT INTO tickets_eliminados (id, fecha_eliminacion) VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET fecha_eliminacion = GREATEST(tickets_eliminados.fecha_eliminacion, EXCLUDED.fecha_eliminacion)
        `, [req.params.id, deletionDate]);
        await client.query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
      });
      res.status(204).end();
    } catch (error) { next(error); }
  });

  return router;
}

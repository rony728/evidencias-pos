import { Router } from 'express';
import { upsertTicket } from '../services/tickets.js';
import { isUuid } from '../utils/tickets.js';

export function createSyncRouter(database) {
  const router = Router();

  router.post('/', async (req, res, next) => {
    const tickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
    const deletedTicketIds = Array.isArray(req.body?.deletedTicketIds) ? req.body.deletedTicketIds : [];
    let client;
    try {
      client = typeof database.connect === 'function' ? await database.connect() : database;
      await client.query('BEGIN');
      const results = [];
      for (const ticket of tickets) results.push(await upsertTicket(client, ticket));
      for (const id of deletedTicketIds) {
        if (!isUuid(id)) throw Object.assign(new Error('Una eliminación contiene un UUID inválido.'), { status: 400 });
        await client.query(`
          INSERT INTO tickets_eliminados (id, fecha_eliminacion) VALUES ($1, NOW())
          ON CONFLICT (id) DO UPDATE SET fecha_eliminacion = GREATEST(tickets_eliminados.fecha_eliminacion, EXCLUDED.fecha_eliminacion)
        `, [id]);
        await client.query('DELETE FROM tickets WHERE id = $1', [id]);
      }
      await client.query('COMMIT');
      res.json({ tickets: results, deletedTicketIds, syncedAt: new Date().toISOString() });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      if (typeof client?.release === 'function') client.release();
    }
  });

  return router;
}

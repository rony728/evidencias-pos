import { normalizeTicket, ticketParams, TICKET_SELECT } from '../utils/tickets.js';

export async function upsertTicket(database, payload) {
  const ticket = normalizeTicket(payload);
  const deleted = await database.query('SELECT fecha_eliminacion FROM tickets_eliminados WHERE id = $1', [ticket.id]);
  if (deleted.rows[0] && new Date(deleted.rows[0].fecha_eliminacion) >= new Date(ticket.fechaModificacion)) {
    return { ticket: null, applied: false, deleted: true };
  }
  if (deleted.rows[0]) await database.query('DELETE FROM tickets_eliminados WHERE id = $1', [ticket.id]);
  const result = await database.query(`
    INSERT INTO tickets (
      id, ticket, ticket_normalizado, cliente, telefono, observaciones, estado,
      fecha_creacion, fecha_modificacion, fecha_cierre, dispositivo_pos,
      dispositivo_sim, dispositivo_lectora, dispositivo_token,
      dispositivo_powerbank, dispositivo_otros
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
    )
    ON CONFLICT (id) DO UPDATE SET
      ticket = EXCLUDED.ticket,
      ticket_normalizado = EXCLUDED.ticket_normalizado,
      cliente = EXCLUDED.cliente,
      telefono = EXCLUDED.telefono,
      observaciones = EXCLUDED.observaciones,
      estado = EXCLUDED.estado,
      fecha_creacion = EXCLUDED.fecha_creacion,
      fecha_modificacion = EXCLUDED.fecha_modificacion,
      fecha_cierre = EXCLUDED.fecha_cierre,
      dispositivo_pos = EXCLUDED.dispositivo_pos,
      dispositivo_sim = EXCLUDED.dispositivo_sim,
      dispositivo_lectora = EXCLUDED.dispositivo_lectora,
      dispositivo_token = EXCLUDED.dispositivo_token,
      dispositivo_powerbank = EXCLUDED.dispositivo_powerbank,
      dispositivo_otros = EXCLUDED.dispositivo_otros
    WHERE EXCLUDED.fecha_modificacion >= tickets.fecha_modificacion
    RETURNING ${TICKET_SELECT}
  `, ticketParams(ticket));

  if (result.rows[0]) return { ticket: result.rows[0], applied: true };
  const current = await database.query(`SELECT ${TICKET_SELECT} FROM tickets WHERE id = $1`, [ticket.id]);
  return { ticket: current.rows[0], applied: false };
}

export async function getTicket(database, id) {
  const result = await database.query(`SELECT ${TICKET_SELECT} FROM tickets WHERE id = $1`, [id]);
  return result.rows[0];
}

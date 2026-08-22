import { Router } from 'express';
import multer from 'multer';
import { isUuid, VALID_IMAGE_TYPES } from '../utils/tickets.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }
});

function validateUuid(id) {
  if (!isUuid(id)) throw Object.assign(new Error('El ID no es un UUID válido.'), { status: 400 });
}

export function createImagesRouter(database) {
  const router = Router();

  router.get('/tickets/:id/imagenes', async (req, res, next) => {
    try {
      validateUuid(req.params.id);
      const result = await database.query(`
        SELECT id, ticket_id AS "ticketId", tipo, mime_type AS "mimeType", fecha
        FROM imagenes WHERE ticket_id = $1 ORDER BY fecha ASC
      `, [req.params.id]);
      res.json({ imagenes: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/tickets/:id/imagenes', upload.single('imagen'), async (req, res, next) => {
    try {
      validateUuid(req.params.id);
      validateUuid(req.body.id);
      if (!VALID_IMAGE_TYPES.has(req.body.tipo)) throw Object.assign(new Error('Tipo de fotografía no válido.'), { status: 400 });
      if (!req.file?.buffer || !req.file.mimetype.startsWith('image/')) throw Object.assign(new Error('Debe adjuntar una fotografía válida.'), { status: 400 });
      const fecha = req.body.fecha || new Date().toISOString();
      if (Number.isNaN(Date.parse(fecha))) throw Object.assign(new Error('Fecha de fotografía no válida.'), { status: 400 });
      const result = await database.query(`
        INSERT INTO imagenes (id, ticket_id, tipo, imagen, mime_type, fecha)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          ticket_id = EXCLUDED.ticket_id,
          tipo = EXCLUDED.tipo,
          imagen = EXCLUDED.imagen,
          mime_type = EXCLUDED.mime_type,
          fecha = EXCLUDED.fecha
        WHERE EXCLUDED.fecha >= imagenes.fecha
        RETURNING id, ticket_id AS "ticketId", tipo, mime_type AS "mimeType", fecha
      `, [req.body.id, req.params.id, req.body.tipo, req.file.buffer, req.file.mimetype, fecha]);
      res.status(201).json({ imagen: result.rows[0] || { id: req.body.id, ticketId: req.params.id, tipo: req.body.tipo, mimeType: req.file.mimetype, fecha }, applied: Boolean(result.rows[0]) });
    } catch (error) { next(error); }
  });

  router.get('/imagenes/:id', async (req, res, next) => {
    try {
      validateUuid(req.params.id);
      const result = await database.query('SELECT imagen, mime_type FROM imagenes WHERE id = $1', [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Fotografía no encontrada.' });
      res.type(result.rows[0].mime_type).send(result.rows[0].imagen);
    } catch (error) { next(error); }
  });

  router.delete('/imagenes/:id', async (req, res, next) => {
    try {
      validateUuid(req.params.id);
      await database.query('DELETE FROM imagenes WHERE id = $1', [req.params.id]);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  return router;
}

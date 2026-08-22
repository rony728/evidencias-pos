export function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada.' });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con este nombre de gestión.' });
  if (error.code === '23503') return res.status(409).json({ error: 'El registro relacionado no existe.' });
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La fotografía supera el tamaño permitido.' });
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: status >= 500 ? 'Error interno del servidor.' : error.message });
}

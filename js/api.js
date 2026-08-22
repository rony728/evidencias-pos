import { obtenerApiBaseUrl } from './config.js';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  const baseUrl = obtenerApiBaseUrl();
  if (!baseUrl) throw new ApiError('No hay un servidor configurado.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
      headers: options.body instanceof FormData
        ? options.headers
        : { 'Content-Type': 'application/json', ...options.headers }
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new ApiError(details.error || `El servidor respondió ${response.status}.`, response.status);
    }
    if (response.status === 204) return null;
    return options.responseType === 'blob' ? response.blob() : response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('El servidor tardó demasiado en responder.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('No fue posible conectar con el servidor.');
  } finally {
    clearTimeout(timeout);
  }
}

export const comprobarServidor = () => request('/api/health');
export const obtenerTicketsServidor = () => request('/api/tickets');
export const guardarTicketServidor = (ticket) => request(`/api/tickets/${ticket.id}`, { method: 'PUT', body: JSON.stringify(ticket) });
export const eliminarTicketServidor = (id, fechaEliminacion) => request(`/api/tickets/${id}`, { method: 'DELETE', body: JSON.stringify({ fechaEliminacion }) });
export const obtenerMetadatosImagenes = async (ticketId) => (await request(`/api/tickets/${ticketId}/imagenes`)).imagenes;
export const descargarImagenServidor = (id) => request(`/api/imagenes/${id}`, { responseType: 'blob' });
export const eliminarImagenServidor = (id) => request(`/api/imagenes/${id}`, { method: 'DELETE' });

export async function guardarImagenServidor(imagen) {
  const form = new FormData();
  form.set('id', imagen.id);
  form.set('tipo', imagen.tipo);
  form.set('fecha', imagen.fecha);
  form.set('imagen', imagen.imagen, `${imagen.tipo}.jpg`);
  return (await request(`/api/tickets/${imagen.ticketId}/imagenes`, { method: 'POST', body: form })).imagen;
}

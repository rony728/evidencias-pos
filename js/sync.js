import {
  aplicarImagenServidor,
  aplicarTicketServidor,
  completarOperacion,
  contarPendientesSincronizacion,
  marcarDatosExistentesPendientes,
  marcarImagenSincronizada,
  marcarOperacionError,
  eliminarTicketDesdeServidor,
  obtenerImagen,
  obtenerImagenes,
  obtenerOperacionesPendientes,
  obtenerTicket
} from './db.js';
import {
  comprobarServidor,
  descargarImagenServidor,
  eliminarImagenServidor,
  eliminarTicketServidor,
  guardarImagenServidor,
  guardarTicketServidor,
  obtenerMetadatosImagenes,
  obtenerTicketsServidor
} from './api.js';
import { guardarUltimaSincronizacion, obtenerApiBaseUrl, obtenerUltimaSincronizacion } from './config.js';

let synchronizationPromise = null;
const listeners = new Set();

function avisarCambio() {
  listeners.forEach((listener) => listener());
}

async function procesarOperacion(operation) {
  let resultado = { ticketsEnviados: 0, imagenesEnviadas: 0, omitidos: 0 };
  if (operation.tipo === 'ticket-upsert') {
    const ticket = await obtenerTicket(operation.entidadId);
    if (ticket) {
      const result = await guardarTicketServidor(ticket);
      if (result.deleted) {
        await eliminarTicketDesdeServidor(ticket.id);
        resultado.omitidos += 1;
      } else {
        await aplicarTicketServidor(result.ticket);
        resultado.ticketsEnviados += 1;
      }
    } else resultado.omitidos += 1;
  } else if (operation.tipo === 'ticket-delete') {
    await eliminarTicketServidor(operation.entidadId, operation.fechaCreacion);
    resultado.ticketsEnviados += 1;
  } else if (operation.tipo === 'image-create') {
    const image = await obtenerImagen(operation.entidadId);
    if (image) {
      await guardarImagenServidor(image);
      await marcarImagenSincronizada(image.id);
      resultado.imagenesEnviadas += 1;
    } else resultado.omitidos += 1;
  } else if (operation.tipo === 'image-delete') {
    await eliminarImagenServidor(operation.entidadId);
    resultado.imagenesEnviadas += 1;
  }
  await completarOperacion(operation.id);
  return resultado;
}

async function descargarCambios(pendingOperations = []) {
  const pendingTicketDeletes = new Set(pendingOperations.filter((operation) => operation.tipo === 'ticket-delete').map((operation) => operation.entidadId));
  const pendingImageDeletes = new Set(pendingOperations.filter((operation) => operation.tipo === 'image-delete').map((operation) => operation.entidadId));
  const { tickets, eliminados = [] } = await obtenerTicketsServidor();
  for (const deleted of eliminados) await eliminarTicketDesdeServidor(deleted.id);
  for (const ticket of tickets) {
    if (pendingTicketDeletes.has(ticket.id)) continue;
    await aplicarTicketServidor(ticket);
    const [metadata, localImages] = await Promise.all([
      obtenerMetadatosImagenes(ticket.id),
      obtenerImagenes(ticket.id)
    ]);
    const localIds = new Set(localImages.map((image) => image.id));
    for (const remoteImage of metadata) {
      if (localIds.has(remoteImage.id) || pendingImageDeletes.has(remoteImage.id)) continue;
      const blob = await descargarImagenServidor(remoteImage.id);
      await aplicarImagenServidor({
        id: remoteImage.id,
        ticketId: remoteImage.ticketId,
        tipo: remoteImage.tipo,
        fecha: remoteImage.fecha,
        imagen: blob
      });
    }
  }
}

export async function sincronizar({ descargar = true } = {}) {
  if (synchronizationPromise) return synchronizationPromise;
  synchronizationPromise = (async () => {
    if (!obtenerApiBaseUrl()) throw new Error('Configure primero la dirección HTTPS del servidor.');
    if (!navigator.onLine) throw new Error('El dispositivo no tiene conexión de red.');
    await comprobarServidor();
    const operations = await obtenerOperacionesPendientes();
    const summary = { ticketsEnviados: 0, imagenesEnviadas: 0, omitidos: 0, errores: 0 };
    for (const operation of operations) {
      try {
        const operationResult = await procesarOperacion(operation);
        Object.keys(operationResult).forEach((key) => { summary[key] += operationResult[key]; });
      } catch (error) {
        await marcarOperacionError(operation.id, error);
        summary.errores += 1;
      }
    }
    if (descargar) {
      try { await descargarCambios(await obtenerOperacionesPendientes()); } catch { summary.errores += 1; }
    }
    const ultimaSincronizacion = summary.errores ? obtenerUltimaSincronizacion() : guardarUltimaSincronizacion();
    return { ...summary, ultimaSincronizacion, pendientes: await contarPendientesSincronizacion() };
  })().finally(() => {
    synchronizationPromise = null;
    avisarCambio();
  });
  return synchronizationPromise;
}

export function sincronizarEnSegundoPlano() {
  if (!obtenerApiBaseUrl() || !navigator.onLine) return;
  sincronizar().catch(() => {});
}

export async function sincronizarDatosExistentes() {
  const migrated = await marcarDatosExistentesPendientes();
  const result = await sincronizar();
  return { ...migrated, ...result };
}

export async function obtenerEstadoSincronizacion({ comprobar = false } = {}) {
  const baseUrl = obtenerApiBaseUrl();
  let estado = !baseUrl ? 'sin-configurar' : (navigator.onLine ? 'sin-comprobar' : 'sin-conexion');
  if (comprobar && baseUrl && navigator.onLine) {
    try {
      await comprobarServidor();
      estado = 'conectado';
    } catch {
      estado = 'no-disponible';
    }
  }
  return {
    baseUrl,
    estado,
    pendientes: await contarPendientesSincronizacion(),
    ultimaSincronizacion: obtenerUltimaSincronizacion()
  };
}

export function observarSincronizacion(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function iniciarSincronizacionAutomatica() {
  window.addEventListener('online', sincronizarEnSegundoPlano);
  window.addEventListener('offline', avisarCambio);
  sincronizarEnSegundoPlano();
}

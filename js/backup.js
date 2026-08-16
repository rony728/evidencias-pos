// Respaldo JSON nativo. Las fotografías solo se convierten a texto dentro del archivo exportado.
import { obtenerTodasImagenes, obtenerTickets, restaurarDatos } from './db.js';

const BACKUP_FORMAT_VERSION = 1;
const DEVICE_TYPES = new Set(['pos', 'sim', 'lectora', 'token', 'powerbank', 'otros']);

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer una fotografía.'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = String(dataUrl).split(',');
  const mimeType = header.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
  const binary = atob(body || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function exportarRespaldo() {
  const [tickets, imagenes] = await Promise.all([obtenerTickets(), obtenerTodasImagenes()]);
  const backupImages = await Promise.all(imagenes.map(async (imagen) => ({
    id: imagen.id,
    ticketId: imagen.ticketId,
    tipo: imagen.tipo,
    fecha: imagen.fecha,
    mimeType: imagen.imagen.type || 'image/jpeg',
    data: await blobToDataUrl(imagen.imagen)
  })));
  const payload = {
    format: 'evidencias-pos-backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tickets,
    imagenes: backupImages
  };
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `evidencias-pos-backup-${date}.json`;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

export async function validarYLeerRespaldo(file) {
  if (!file) throw new Error('No se seleccionó un respaldo.');
  const data = JSON.parse(await file.text());
  if (data?.format !== 'evidencias-pos-backup' || data.formatVersion !== BACKUP_FORMAT_VERSION || !Array.isArray(data.tickets) || !Array.isArray(data.imagenes)) {
    throw new Error('El archivo no es un respaldo válido de Evidencias POS.');
  }
  data.tickets.forEach((ticket) => {
    if (!ticket?.id || !ticket.ticket || !ticket.dispositivos || !Object.values(ticket.dispositivos).some(Boolean)) throw new Error('El respaldo contiene un ticket inválido.');
  });
  const imagenes = data.imagenes.map((imagen) => {
    if (!imagen.id || !imagen.ticketId || !DEVICE_TYPES.has(imagen.tipo) || typeof imagen.data !== 'string' || !imagen.data.startsWith('data:image/')) throw new Error('El respaldo contiene una fotografía inválida.');
    return { id: imagen.id, ticketId: imagen.ticketId, tipo: imagen.tipo, fecha: imagen.fecha, imagen: dataUrlToBlob(imagen.data) };
  });
  return { tickets: data.tickets, imagenes, exportedAt: data.exportedAt, ticketCount: data.tickets.length, imageCount: imagenes.length };
}

export async function restaurarRespaldo(data, modo) {
  return restaurarDatos({ ...data, modo });
}

// Procesamiento y persistencia de fotografías como Blob.
import { nuevoIdInterno } from './db.js';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

function cargarImagen(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la fotografía.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo comprimir la fotografía.'));
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

export async function comprimirImagen(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen válida.');
  const image = await cargarImagen(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  return { blob, width: canvas.width, height: canvas.height };
}

export async function guardarImagen({ ticketId, tipo, imagen }) {
  const database = await import('./db.js');
  return database.crearImagen({ id: nuevoIdInterno(), ticketId, tipo, imagen, fecha: new Date().toISOString() });
}

export async function obtenerImagenes(ticketId) {
  const database = await import('./db.js');
  return database.obtenerImagenes(ticketId);
}

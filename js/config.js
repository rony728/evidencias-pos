// Configuración central del servidor. Nunca se guardan credenciales en el código.
const API_URL_KEY = 'evidencias-api-url';
const LAST_SYNC_KEY = 'evidencias-ultima-sincronizacion';

export function obtenerApiBaseUrl() {
  return (localStorage.getItem(API_URL_KEY) || '').replace(/\/+$/, '');
}

export function guardarApiBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    localStorage.removeItem(API_URL_KEY);
    return '';
  }
  const url = new URL(normalized);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('El servidor debe utilizar HTTPS. HTTP solo se permite en localhost para pruebas.');
  }
  localStorage.setItem(API_URL_KEY, normalized);
  return normalized;
}

export function obtenerUltimaSincronizacion() {
  return localStorage.getItem(LAST_SYNC_KEY);
}

export function guardarUltimaSincronizacion(fecha = new Date().toISOString()) {
  localStorage.setItem(LAST_SYNC_KEY, fecha);
  return fecha;
}

// Funciones pequeñas de interfaz compartidas por las pantallas.
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
}

export function showToast(message) {
  const region = document.querySelector('#toast-region');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

export function formatDateTime(value) {
  if (!value) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-HN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

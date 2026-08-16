import { actualizarTicket, buscarTickets, cerrarTicket, crearTicket, eliminarCerradosAntiguos, eliminarTicket, obtenerPendientes, obtenerResumenAlmacenamiento, obtenerTickets, reabrirTicket } from './db.js';
import { exportarRespaldo, restaurarRespaldo, validarYLeerRespaldo } from './backup.js';
import { comprimirImagen, guardarImagen, obtenerImagenes } from './images.js';
import { escapeHtml, formatDateTime, showToast } from './ui.js';

const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const backButton = document.querySelector('[data-action="back"]');
let selectedRecord = null;
let pendingPhotos = new Map();
let pendingRestore = null;

const deviceLabels = { pos: 'POS', sim: 'SIM', lectora: 'Lectora', token: 'Token', powerbank: 'Powerbank', otros: 'Otros' };

function recordCard(record) {
  const estado = record.estado === 'cerrado' ? 'CERRADO' : 'PENDIENTE';
  return `<button class="record-card" type="button" data-record-id="${escapeHtml(record.id)}">
    <strong>Nombre de Gestión: ${escapeHtml(record.ticket)}</strong>
    <p>${escapeHtml(record.cliente)}</p>
    <div class="record-meta"><span>${escapeHtml(formatDateTime(record.fechaCreacion))}</span><span>${estado}</span></div>
  </button>`;
}

function renderEmpty(message) {
  return `<p class="empty-state">${escapeHtml(message)}</p>`;
}

async function renderHome() {
  const cleanupDays = localStorage.getItem('evidencias-auto-cleanup') || 'never';
  if (cleanupDays !== 'never') await eliminarCerradosAntiguos(cleanupDays);
  const pending = await obtenerPendientes();
  app.innerHTML = `<section class="hero"><h2>Tu visita, documentada.</h2><p class="subtitle">Registra evidencias de reemplazos rápidamente, incluso sin conexión.</p></section>
    <div class="actions-grid">
      <button class="button button-primary" type="button" data-route="new">＋ NUEVO REGISTRO</button>
      <button class="button button-secondary" type="button" data-route="search">⌕ BUSCAR</button>
      <button class="button button-ghost" type="button" data-route="all">VER TODOS LOS REGISTROS</button>
      <button class="button button-ghost" type="button" data-route="settings">⚙ CONFIGURACIÓN</button>
    </div>
    <section><div class="section-heading"><h2>Pendientes</h2><span class="helper">${pending.length} registros</span></div><div class="record-list">${pending.length ? pending.map(recordCard).join('') : renderEmpty('No hay tickets pendientes.')}</div></section>`;
}

function renderNew() {
  app.innerHTML = `<section class="hero"><h2>Nuevo registro</h2><p class="subtitle">Completa los datos de la visita y selecciona los dispositivos reemplazados.</p></section>
    <form class="form-card" id="new-ticket-form">
      <div class="field"><label for="ticket">Nombre de Gestión</label><input id="ticket" name="ticket" type="text" required placeholder="Ej. Cambio POS 584721"></div>
      <div class="field"><label for="cliente">Nombre del cliente <span class="helper">(opcional)</span></label><input id="cliente" name="cliente" placeholder="Ej. Juan Pérez"></div>
      <div class="field"><label for="telefono">Teléfono del cliente <span class="helper">(opcional)</span></label><input id="telefono" name="telefono" type="tel" placeholder="Ej. 9999-9999"></div>
      <div class="field"><label for="observaciones">Observaciones <span class="helper">(opcional)</span></label><textarea id="observaciones" name="observaciones" placeholder="Notas de la visita..."></textarea></div>
      <fieldset><legend>¿Qué dispositivos reemplazaste?</legend><div class="device-grid">
        ${Object.entries(deviceLabels).map(([value, label]) => `<label class="device-option"><input type="checkbox" name="dispositivos" value="${value}"><span>${label}</span></label>`).join('')}
      </div></fieldset>
      <button class="button button-primary" type="submit">CONTINUAR</button>
    </form>`;

  document.querySelector('#new-ticket-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const selectedDevices = [...form.querySelectorAll('input[name="dispositivos"]:checked')].map((input) => input.value);
    if (!selectedDevices.length) {
      showToast('Debe seleccionar al menos un dispositivo.');
      return;
    }
    const datos = Object.fromEntries(new FormData(form).entries());
    datos.dispositivos = Object.fromEntries(Object.keys(deviceLabels).map((device) => [device, selectedDevices.includes(device)]));

    try {
      selectedRecord = await crearTicket(datos);
      pendingPhotos = new Map();
      showToast('Registro guardado correctamente.');
      await navigate('capture');
    } catch (error) {
      const userError = ['TICKET_DUPLICADO', 'DATOS_INCOMPLETOS', 'SIN_DISPOSITIVOS'].includes(error.code);
      showToast(userError ? error.message : 'Error al guardar la información.');
      if (!userError) console.error(error);
    }
  });
}

function renderPhotoPreview(type) {
  const preview = document.querySelector(`[data-photo-preview="${type}"]`);
  const photo = pendingPhotos.get(type);
  if (!preview || !photo) return;
  preview.innerHTML = `<img src="${photo.url}" alt="Vista previa de ${escapeHtml(deviceLabels[type])}"><button class="button button-ghost photo-repeat" type="button" data-repeat-photo="${type}">REPETIR FOTO</button><p class="photo-info">${photo.width} × ${photo.height}px · ${(photo.blob.size / 1024 / 1024).toFixed(2)} MB</p>`;
}

function renderCapture(ticket) {
  const selectedDevices = Object.entries(ticket.dispositivos || {}).filter(([, selected]) => selected).map(([type]) => type);
  app.innerHTML = `<section class="hero"><h2>Fotografías</h2><p class="subtitle">Toma una fotografía por cada dispositivo reemplazado. Las imágenes se comprimen localmente antes de guardarse.</p></section>
    <div class="photo-list">${selectedDevices.map((type) => `<section class="photo-card"><div class="photo-heading"><h3>${deviceLabels[type]}</h3><span class="helper">Obligatoria</span></div><div class="photo-preview" data-photo-preview="${type}"><p class="empty-state">Todavía no hay fotografía.</p></div><input class="file-input" id="photo-${type}" type="file" accept="image/*" capture="environment" data-photo-input="${type}"><label class="button button-secondary" for="photo-${type}">TOMAR FOTO</label></section>`).join('')}</div>
    <div class="button-stack"><button class="button button-primary" type="button" data-action="save-photos">GUARDAR FOTOGRAFÍAS</button><button class="button button-ghost" type="button" data-action="skip-photos">GUARDAR SIN FOTOGRAFÍAS</button></div>`;

  document.querySelectorAll('[data-photo-input]').forEach((input) => input.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    const type = event.target.dataset.photoInput;
    if (!file) return;
    try {
      showToast('Procesando fotografía...');
      const compressed = await comprimirImagen(file);
      const previous = pendingPhotos.get(type);
      if (previous) URL.revokeObjectURL(previous.url);
      pendingPhotos.set(type, { ...compressed, url: URL.createObjectURL(compressed.blob) });
      renderPhotoPreview(type);
      showToast('Fotografía lista para guardar.');
    } catch (error) {
      showToast('No se pudo procesar la fotografía.');
      console.error(error);
    }
    event.target.value = '';
  }));
}

async function guardarFotosSeleccionadas() {
  const selectedTypes = Object.entries(selectedRecord.dispositivos || {}).filter(([, selected]) => selected).map(([type]) => type);
  if (selectedTypes.some((type) => !pendingPhotos.has(type))) {
    showToast('Debe tomar una fotografía de cada dispositivo seleccionado.');
    return;
  }
  try {
    for (const type of selectedTypes) await guardarImagen({ ticketId: selectedRecord.id, tipo: type, imagen: pendingPhotos.get(type).blob });
    showToast('Fotografías guardadas correctamente.');
    await navigate('detail');
  } catch (error) {
    showToast('Error al guardar las fotografías.');
    console.error(error);
  }
}

async function renderSearch() {
  app.innerHTML = `<section class="hero"><h2>Buscar</h2><p class="subtitle">Encuentra un registro por nombre de gestión, cliente o teléfono.</p></section>
    <div class="search-wrap"><input class="search-input" id="search-input" type="search" placeholder="Nombre de Gestión / Cliente / Teléfono" aria-label="Buscar por nombre de gestión, cliente o teléfono"></div>
    <div id="search-results" class="record-list">${renderEmpty('Cargando registros...')}</div>`;
  const results = document.querySelector('#search-results');
  async function updateResults(term = '') {
    const matches = await buscarTickets(term);
    results.innerHTML = matches.length ? matches.map(recordCard).join('') : renderEmpty('No se encontraron resultados.');
  }
  document.querySelector('#search-input').addEventListener('input', (event) => updateResults(event.target.value).catch(() => { results.innerHTML = renderEmpty('Error al buscar los registros.'); }));
  await updateResults();
}

async function renderAll() {
  const tickets = await obtenerTickets();
  app.innerHTML = `<section class="hero"><h2>Todos los registros</h2><p class="subtitle">Aquí aparecen tickets pendientes y cerrados.</p></section><div class="record-list">${tickets.length ? tickets.map(recordCard).join('') : renderEmpty('Todavía no hay registros.')}</div>`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function renderSettings() {
  const summary = await obtenerResumenAlmacenamiento();
  let usage = 'No disponible';
  let quota = '';
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    usage = formatBytes(estimate.usage || summary.bytes);
    quota = estimate.quota ? ` de ${formatBytes(estimate.quota)}` : '';
  }
  let persisted = 'No confirmado';
  if (navigator.storage?.persisted) persisted = (await navigator.storage.persisted()) ? 'Protegido' : 'No protegido';
  const cleanup = localStorage.getItem('evidencias-auto-cleanup') || 'never';
  app.innerHTML = `<section class="hero"><h2>Configuración</h2><p class="subtitle">Datos, respaldo y almacenamiento de este dispositivo.</p></section>
    <section class="settings-section"><h3>Copias de seguridad</h3><p class="helper">Formato JSON nativo. Incluye tickets y fotografías sin servicios externos.</p><div class="button-stack"><button class="button button-secondary" type="button" data-action="export-backup">EXPORTAR RESPALDO</button><input class="file-input" id="restore-file" type="file" accept="application/json,.json"><label class="button button-ghost" for="restore-file">RESTAURAR RESPALDO</label></div>
    <dialog class="app-dialog" id="restore-dialog"><h3>¿Cómo desea restaurar?</h3><p>El respaldo contiene ${pendingRestore?.ticketCount || 0} registros y ${pendingRestore?.imageCount || 0} fotografías. Esta acción modificará los datos locales.</p><div class="button-stack"><button class="button button-danger" type="button" data-restore-mode="reemplazar">REEMPLAZAR DATOS ACTUALES</button><button class="button button-primary" type="button" data-restore-mode="combinar">COMBINAR CON DATOS ACTUALES</button><button class="button button-ghost" type="button" data-close-restore>CANCELAR</button></div></dialog></section>
    <section class="settings-section"><h3>ALMACENAMIENTO</h3><div class="storage-grid"><span>Registros</span><strong>${summary.tickets}</strong><span>Fotografías</span><strong>${summary.imagenes}</strong><span>Espacio aproximado</span><strong>${formatBytes(summary.bytes)}${usage !== 'No disponible' ? ` · navegador: ${usage}${quota}` : ''}</strong><span>Protección persistente</span><strong>${persisted}</strong></div><button class="button button-ghost" type="button" data-action="request-persist">PROTEGER ALMACENAMIENTO</button></section>
    <section class="settings-section"><h3>LIMPIEZA AUTOMÁTICA</h3><div class="field"><label for="auto-cleanup">Eliminar automáticamente registros cerrados</label><select id="auto-cleanup"><option value="never" ${cleanup === 'never' ? 'selected' : ''}>Nunca</option><option value="30" ${cleanup === '30' ? 'selected' : ''}>30 días</option><option value="60" ${cleanup === '60' ? 'selected' : ''}>60 días</option><option value="90" ${cleanup === '90' ? 'selected' : ''}>90 días</option></select></div><p class="helper">La limpieza se ejecuta al volver a Inicio y solo afecta registros cerrados.</p></section>
    <section class="settings-section"><h3>Privacidad</h3><p class="helper">Todos los datos, fotografías y registros se almacenan localmente en este dispositivo. La aplicación no envía información a Internet.</p></section>`;
  document.querySelector('#auto-cleanup').addEventListener('change', (event) => { localStorage.setItem('evidencias-auto-cleanup', event.target.value); showToast('Configuración de limpieza guardada.'); });
  document.querySelector('#restore-file').addEventListener('change', async (event) => {
    try {
      pendingRestore = await validarYLeerRespaldo(event.target.files?.[0]);
      const dialog = document.querySelector('#restore-dialog');
      dialog.querySelector('p').textContent = `El respaldo contiene ${pendingRestore.ticketCount} registros y ${pendingRestore.imageCount} fotografías. Esta acción modificará los datos locales.`;
      dialog.showModal();
    } catch (error) {
      pendingRestore = null;
      showToast(error.message || 'El respaldo no es válido.');
    }
    event.target.value = '';
  });
}

function renderEdit(record) {
  app.innerHTML = `<section class="hero"><h2>Editar registro</h2><p class="subtitle">Actualiza el nombre de gestión y los datos opcionales. Las fotografías y dispositivos seleccionados se conservarán.</p></section>
    <form class="form-card" id="edit-ticket-form">
      <div class="field"><label for="edit-ticket">Nombre de Gestión</label><input id="edit-ticket" name="ticket" type="text" required value="${escapeHtml(record.ticket)}"></div>
      <div class="field"><label for="edit-cliente">Nombre del cliente <span class="helper">(opcional)</span></label><input id="edit-cliente" name="cliente" value="${escapeHtml(record.cliente)}"></div>
      <div class="field"><label for="edit-telefono">Teléfono del cliente <span class="helper">(opcional)</span></label><input id="edit-telefono" name="telefono" type="tel" value="${escapeHtml(record.telefono)}"></div>
      <div class="field"><label for="edit-observaciones">Observaciones <span class="helper">(opcional)</span></label><textarea id="edit-observaciones" name="observaciones">${escapeHtml(record.observaciones || '')}</textarea></div>
      <button class="button button-primary" type="submit">GUARDAR CAMBIOS</button>
    </form>`;
  document.querySelector('#edit-ticket-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const changes = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      selectedRecord = await actualizarTicket({ ...record, ...changes });
      showToast('Cambios guardados correctamente.');
      await navigate('detail');
    } catch (error) {
      showToast(error.code === 'TICKET_DUPLICADO' ? error.message : 'Error al actualizar la información.');
      if (error.code !== 'TICKET_DUPLICADO') console.error(error);
    }
  });
}

async function renderDetail(record) {
  selectedRecord = record;
  const devices = Object.entries(record.dispositivos || {}).filter(([, selected]) => selected).map(([type]) => deviceLabels[type]);
  const images = await obtenerImagenes(record.id);
  const gallery = images.length ? images.map((item) => {
    const imageUrl = URL.createObjectURL(item.imagen);
    const label = deviceLabels[item.tipo] || item.tipo;
    return `<button class="stored-photo" type="button" data-open-photo="${escapeHtml(imageUrl)}" aria-label="Abrir fotografía de ${escapeHtml(label)}"><img src="${escapeHtml(imageUrl)}" alt="Fotografía de ${escapeHtml(label)}"><span>${escapeHtml(label)}</span></button>`;
  }).join('') : renderEmpty('Todavía no hay fotografías guardadas.');
  const closeDate = record.fechaCierre ? `<div class="detail-row"><span class="detail-label">Fecha de cierre</span><span>${escapeHtml(formatDateTime(record.fechaCierre))}</span></div>` : '';
  const stateAction = record.estado === 'cerrado'
    ? '<button class="button button-primary" type="button" data-action="reopen-ticket">REABRIR TICKET</button>'
    : '<button class="button button-primary" type="button" data-action="close-ticket">MARCAR COMO CERRADO</button>';
  app.innerHTML = `<section class="hero"><h2>Detalle del registro</h2><p class="subtitle">Información de la gestión guardada localmente.</p></section>
    <div class="detail-card"><div class="detail-row"><span class="detail-label">Nombre de Gestión</span><strong>${escapeHtml(record.ticket)}</strong></div><div class="detail-row"><span class="detail-label">Fecha</span><span>${escapeHtml(formatDateTime(record.fechaCreacion))}</span></div>${closeDate}<div class="detail-row"><span class="detail-label">Cliente</span><span>${escapeHtml(record.cliente || 'Sin nombre')}</span></div><div class="detail-row"><span class="detail-label">Teléfono</span><span>${escapeHtml(record.telefono || 'Sin teléfono')}</span></div><div class="detail-row"><span class="detail-label">Estado</span><span class="status-badge ${record.estado === 'cerrado' ? 'is-closed' : ''}">${escapeHtml(record.estado.toUpperCase())}</span></div><div class="detail-row"><span class="detail-label">Observaciones</span><span>${escapeHtml(record.observaciones || 'Sin observaciones')}</span></div><div class="detail-row"><span class="detail-label">Dispositivos</span><span>${escapeHtml(devices.join(', ') || 'Sin dispositivos')}</span></div></div>
    <section class="stored-gallery"><div class="section-heading"><h2>Fotografías</h2><span class="helper">${images.length}</span></div><div class="photo-gallery">${gallery}</div></section>
    <div class="button-stack"><button class="button button-secondary" type="button" data-action="edit-ticket">EDITAR</button>${stateAction}<button class="button button-danger" type="button" data-action="delete-ticket">ELIMINAR</button></div>`;
}

async function navigate(route) {
  title.textContent = route === 'new' ? 'Nuevo registro' : route === 'capture' ? 'Fotografías' : route === 'search' ? 'Buscar' : route === 'all' ? 'Registros' : route === 'settings' ? 'Configuración' : route === 'detail' ? 'Detalle' : 'Evidencias Soporte';
  backButton.hidden = route === 'home';
  document.querySelectorAll('.bottom-nav [data-route]').forEach((button) => button.classList.toggle('is-active', button.dataset.route === route));
  try {
    if (route === 'home') await renderHome();
    else if (route === 'new') renderNew();
    else if (route === 'capture') renderCapture(selectedRecord);
    else if (route === 'edit') renderEdit(selectedRecord);
    else if (route === 'search') await renderSearch();
    else if (route === 'all') await renderAll();
    else if (route === 'settings') await renderSettings();
    else await renderDetail(selectedRecord);
    app.focus();
  } catch (error) {
    app.innerHTML = renderEmpty('No se pudo cargar la información local.');
    showToast('Error al consultar la información.');
    console.error(error);
  }
}

document.addEventListener('click', (event) => {
  const routeButton = event.target.closest('[data-route]');
  if (routeButton) void navigate(routeButton.dataset.route);
  const recordButton = event.target.closest('[data-record-id]');
  if (recordButton) void obtenerTickets().then((tickets) => { selectedRecord = tickets.find((record) => record.id === recordButton.dataset.recordId); if (selectedRecord) return navigate('detail'); showToast('No se encontró el registro.'); }).catch(() => showToast('Error al abrir el registro.'));
  const repeatButton = event.target.closest('[data-repeat-photo]');
  if (repeatButton) document.querySelector(`[data-photo-input="${repeatButton.dataset.repeatPhoto}"]`)?.click();
  const openPhoto = event.target.closest('[data-open-photo]');
  if (openPhoto) {
    const lightbox = document.createElement('div');
    lightbox.className = 'photo-lightbox';
    lightbox.innerHTML = `<button class="button button-ghost" type="button" data-close-lightbox>CERRAR</button><img src="${openPhoto.dataset.openPhoto}" alt="Fotografía ampliada">`;
    document.body.append(lightbox);
  }
  if (event.target.closest('[data-close-lightbox]') || (event.target.classList.contains('photo-lightbox') && !event.target.closest('img'))) document.querySelector('.photo-lightbox')?.remove();
  if (event.target.closest('[data-action="back"]')) void navigate('home');
  if (event.target.closest('[data-action="save-photos"]')) void guardarFotosSeleccionadas();
  if (event.target.closest('[data-action="skip-photos"]')) void navigate('detail');
  if (event.target.closest('[data-action="export-backup"]')) {
    void exportarRespaldo().then((fileName) => showToast(`Respaldo exportado: ${fileName}`)).catch((error) => { showToast('No se pudo exportar el respaldo.'); console.error(error); });
  }
  if (event.target.closest('[data-action="request-persist"]')) {
    void (async () => {
      if (!navigator.storage?.persist) { showToast('Este navegador no permite proteger el almacenamiento.'); return; }
      const granted = await navigator.storage.persist();
      showToast(granted ? 'Almacenamiento protegido correctamente.' : 'El navegador no concedió protección persistente.');
      await navigate('settings');
    })().catch((error) => { showToast('No se pudo solicitar protección de almacenamiento.'); console.error(error); });
  }
  const restoreMode = event.target.closest('[data-restore-mode]');
  if (restoreMode && pendingRestore) {
    void restaurarRespaldo(pendingRestore, restoreMode.dataset.restoreMode).then(async () => { pendingRestore = null; document.querySelector('#restore-dialog')?.close(); showToast('Respaldo restaurado correctamente.'); await navigate('home'); }).catch((error) => { showToast(error.message || 'No se pudo restaurar el respaldo.'); console.error(error); });
  }
  if (event.target.closest('[data-close-restore]')) { pendingRestore = null; document.querySelector('#restore-dialog')?.close(); }
  if (event.target.closest('[data-action="edit-ticket"]')) void navigate('edit');
  if (event.target.closest('[data-action="close-ticket"]')) {
    void cerrarTicket(selectedRecord.id).then(async (updated) => { selectedRecord = updated; showToast('Gestión marcada como cerrada.'); await navigate('detail'); }).catch((error) => { showToast('Error al cerrar la gestión.'); console.error(error); });
  }
  if (event.target.closest('[data-action="reopen-ticket"]')) {
    void reabrirTicket(selectedRecord.id).then(async (updated) => { selectedRecord = updated; showToast('Gestión reabierta correctamente.'); await navigate('detail'); }).catch((error) => { showToast('Error al reabrir la gestión.'); console.error(error); });
  }
  if (event.target.closest('[data-action="delete-ticket"]')) {
    if (!selectedRecord || !window.confirm('¿Está seguro de eliminar este registro?\n\nTambién se eliminarán todas sus fotografías.')) return;
    void eliminarTicket(selectedRecord.id).then(async () => { selectedRecord = null; showToast('Registro eliminado correctamente.'); await navigate('home'); }).catch((error) => { showToast('Error al eliminar el registro.'); console.error(error); });
  }
  if (event.target.closest('[data-action="planned"]')) showToast('Esta función se implementará en una etapa posterior.');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch((error) => console.error('No se pudo registrar el modo offline.', error)));
}

void navigate('home');

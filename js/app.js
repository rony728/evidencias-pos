import { buscarTickets, cerrarTicket, crearTicket, eliminarCerradosAntiguos, eliminarTicket, guardarEdicionCompleta, obtenerPendientes, obtenerResumenAlmacenamiento, obtenerTickets, reabrirTicket } from './db.js';
import { exportarRespaldo, restaurarRespaldo, validarYLeerRespaldo } from './backup.js';
import { comprimirImagen, guardarImagen, obtenerImagenes } from './images.js';
import { escapeHtml, formatDateTime, showToast } from './ui.js';
import { guardarApiBaseUrl } from './config.js';
import { iniciarSincronizacionAutomatica, observarSincronizacion, obtenerEstadoSincronizacion, sincronizar, sincronizarDatosExistentes, sincronizarEnSegundoPlano } from './sync.js';

const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const backButton = document.querySelector('[data-action="back"]');
let selectedRecord = null;
let pendingPhotos = new Map();
let pendingRestore = null;
let currentRoute = 'home';
let editState = null;
const activeObjectUrls = new Set();

const deviceLabels = { pos: 'POS', sim: 'SIM', lectora: 'Lectora', token: 'Token', powerbank: 'Powerbank', otros: 'Otros' };

function crearObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  activeObjectUrls.add(url);
  return url;
}

function liberarObjectUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  activeObjectUrls.delete(url);
}

function limpiarObjectUrls() {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls.clear();
}

function limpiarEstadoRegistroTemporal() {
  limpiarObjectUrls();
  pendingPhotos = new Map();
  editState = null;
}

async function procesarArchivoFoto(file, type, destination, onReady) {
  if (!file) return;
  try {
    showToast('Procesando fotografía...');
    const compressed = await comprimirImagen(file);
    const previous = destination.get(type);
    if (previous?.url) liberarObjectUrl(previous.url);
    destination.set(type, { ...compressed, url: crearObjectUrl(compressed.blob) });
    onReady(type);
    showToast('Fotografía lista para guardar.');
  } catch (error) {
    showToast('No se pudo procesar la fotografía.');
    console.error(error);
  }
}

function photoSourceControls(type, context, hasPhoto = false) {
  const cameraId = `${context}-camera-${type}`;
  const galleryId = `${context}-gallery-${type}`;
  return `<div class="photo-source-actions">
    <input class="file-input" id="${cameraId}" type="file" accept="image/*" capture="environment" data-photo-input="${type}" data-photo-context="${context}">
    <label class="button button-secondary" for="${cameraId}">${hasPhoto ? 'TOMAR NUEVA FOTO' : 'TOMAR FOTO'}</label>
    <input class="file-input" id="${galleryId}" type="file" accept="image/*" data-photo-input="${type}" data-photo-context="${context}">
    <label class="button button-ghost" for="${galleryId}">ELEGIR DE GALERÍA</label>
  </div>`;
}

function iniciarNuevoRegistro() {
  selectedRecord = null;
  limpiarEstadoRegistroTemporal();
  return navigate('new');
}

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
  if (cleanupDays !== 'never' && await eliminarCerradosAntiguos(cleanupDays)) sincronizarEnSegundoPlano();
  const [pending, syncState] = await Promise.all([
    obtenerPendientes(),
    obtenerEstadoSincronizacion({ comprobar: true })
  ]);
  const lastSync = syncState.ultimaSincronizacion ? formatDateTime(syncState.ultimaSincronizacion) : 'Nunca';
  app.innerHTML = `<section class="hero"><h2>Tu visita, documentada.</h2><p class="subtitle">Registra evidencias de reemplazos rápidamente, incluso sin conexión.</p></section>
    <div class="actions-grid">
      <button class="button button-primary" type="button" data-route="new">＋ NUEVO REGISTRO</button>
      <button class="button button-secondary" type="button" data-route="search">⌕ BUSCAR</button>
      <button class="button button-ghost" type="button" data-route="all">VER TODOS LOS REGISTROS</button>
      <button class="button button-ghost" type="button" data-route="settings">⚙ CONFIGURACIÓN</button>
    </div>
    <section class="home-sync" aria-label="Sincronización">
      <div><span>Última sincronización</span><strong>${escapeHtml(lastSync)}</strong></div>
      <button class="button button-secondary" type="button" data-action="sync-now" ${syncState.baseUrl ? '' : 'disabled'}>SINCRONIZAR AHORA</button>
    </section>
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
      sincronizarEnSegundoPlano();
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
  preview.innerHTML = `<img src="${photo.url}" alt="Vista previa de ${escapeHtml(deviceLabels[type])}"><p class="photo-info">${photo.width} × ${photo.height}px · ${(photo.blob.size / 1024 / 1024).toFixed(2)} MB</p>`;
}

function renderCapture(ticket) {
  const selectedDevices = Object.entries(ticket.dispositivos || {}).filter(([, selected]) => selected).map(([type]) => type);
  app.innerHTML = `<section class="hero"><h2>Fotografías</h2><p class="subtitle">Toma o elige una fotografía por cada dispositivo reemplazado. Las imágenes se comprimen localmente antes de guardarse.</p></section>
    <div class="photo-list">${selectedDevices.map((type) => `<section class="photo-card"><div class="photo-heading"><h3>${deviceLabels[type]}</h3><span class="helper">Obligatoria</span></div><div class="photo-preview" data-photo-preview="${type}"><p class="empty-state">Todavía no hay fotografía.</p></div>${photoSourceControls(type, 'capture')}</section>`).join('')}</div>
    <div class="button-stack"><button class="button button-primary" type="button" data-action="save-photos">GUARDAR FOTOGRAFÍAS</button><button class="button button-ghost" type="button" data-action="skip-photos">GUARDAR SIN FOTOGRAFÍAS</button></div>`;

  document.querySelectorAll('[data-photo-input]').forEach((input) => input.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    const type = event.target.dataset.photoInput;
    if (!file) return;
    await procesarArchivoFoto(file, type, pendingPhotos, renderPhotoPreview);
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
    sincronizarEnSegundoPlano();
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
  const [summary, syncState] = await Promise.all([obtenerResumenAlmacenamiento(), obtenerEstadoSincronizacion({ comprobar: true })]);
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
  const syncLabels = { 'sin-configurar': 'Sin configurar', 'sin-conexion': 'Sin conexión', 'sin-comprobar': 'Sin comprobar', conectado: 'Conectado', 'no-disponible': 'No disponible' };
  const lastSync = syncState.ultimaSincronizacion ? formatDateTime(syncState.ultimaSincronizacion) : 'Nunca';
  app.innerHTML = `<section class="hero"><h2>Configuración</h2><p class="subtitle">Datos, respaldo y almacenamiento de este dispositivo.</p></section>
    <section class="settings-section"><h3>SERVIDOR</h3><p class="helper">La aplicación siempre guarda primero en el teléfono. Cuando este servidor HTTPS está disponible, sincroniza una copia sin bloquear el trabajo offline.</p><div class="field"><label for="api-base-url">Dirección del servidor</label><input id="api-base-url" type="url" inputmode="url" placeholder="https://servidor.ejemplo.com" value="${escapeHtml(syncState.baseUrl)}"></div><div class="storage-grid"><span>Estado</span><strong>${escapeHtml(syncLabels[syncState.estado] || syncState.estado)}</strong><span>Cambios pendientes</span><strong>${syncState.pendientes}</strong><span>Última sincronización</span><strong>${escapeHtml(lastSync)}</strong></div><div class="button-stack"><button class="button button-secondary" type="button" data-action="save-server">GUARDAR SERVIDOR</button><button class="button button-primary" type="button" data-action="sync-now" ${syncState.baseUrl ? '' : 'disabled'}>SINCRONIZAR AHORA</button><button class="button button-ghost" type="button" data-action="sync-existing" ${syncState.baseUrl ? '' : 'disabled'}>SUBIR DATOS EXISTENTES</button></div></section>
    <section class="settings-section"><h3>Copias de seguridad</h3><p class="helper">Formato JSON nativo. Incluye tickets y fotografías sin servicios externos.</p><div class="button-stack"><button class="button button-secondary" type="button" data-action="export-backup">EXPORTAR RESPALDO</button><input class="file-input" id="restore-file" type="file" accept="application/json,.json"><label class="button button-ghost" for="restore-file">RESTAURAR RESPALDO</label></div>
    <dialog class="app-dialog" id="restore-dialog"><h3>¿Cómo desea restaurar?</h3><p>El respaldo contiene ${pendingRestore?.ticketCount || 0} registros y ${pendingRestore?.imageCount || 0} fotografías. Esta acción modificará los datos locales.</p><div class="button-stack"><button class="button button-danger" type="button" data-restore-mode="reemplazar">REEMPLAZAR DATOS ACTUALES</button><button class="button button-primary" type="button" data-restore-mode="combinar">COMBINAR CON DATOS ACTUALES</button><button class="button button-ghost" type="button" data-close-restore>CANCELAR</button></div></dialog></section>
    <section class="settings-section"><h3>ALMACENAMIENTO</h3><div class="storage-grid"><span>Registros</span><strong>${summary.tickets}</strong><span>Fotografías</span><strong>${summary.imagenes}</strong><span>Espacio aproximado</span><strong>${formatBytes(summary.bytes)}${usage !== 'No disponible' ? ` · navegador: ${usage}${quota}` : ''}</strong><span>Protección persistente</span><strong>${persisted}</strong></div><button class="button button-ghost" type="button" data-action="request-persist">PROTEGER ALMACENAMIENTO</button></section>
    <section class="settings-section"><h3>LIMPIEZA AUTOMÁTICA</h3><div class="field"><label for="auto-cleanup">Eliminar automáticamente registros cerrados</label><select id="auto-cleanup"><option value="never" ${cleanup === 'never' ? 'selected' : ''}>Nunca</option><option value="30" ${cleanup === '30' ? 'selected' : ''}>30 días</option><option value="60" ${cleanup === '60' ? 'selected' : ''}>60 días</option><option value="90" ${cleanup === '90' ? 'selected' : ''}>90 días</option></select></div><p class="helper">La limpieza se ejecuta al volver a Inicio y solo afecta registros cerrados.</p></section>
    <section class="settings-section"><h3>Privacidad</h3><p class="helper">Todos los datos se almacenan localmente en este dispositivo. Solo se envía una copia al servidor privado que usted configure; no hay analítica, servicios externos ni transferencias a terceros.</p></section>`;
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

function fotoEfectivaEdicion(type) {
  const pending = editState?.pendingPhotos.get(type);
  if (pending) return { ...pending, temporal: true };
  if (editState?.deletedTypes.has(type)) return null;
  return editState?.existingImages.get(type) || null;
}

function renderEditPhotoBlocks() {
  const container = document.querySelector('#edit-photo-list');
  const form = document.querySelector('#edit-ticket-form');
  if (!container || !form || !editState) return;
  const selectedTypes = [...form.querySelectorAll('input[name="dispositivos"]:checked')].map((input) => input.value);
  container.innerHTML = selectedTypes.map((type) => {
    const photo = fotoEfectivaEdicion(type);
    const preview = photo
      ? `<img src="${escapeHtml(photo.url)}" alt="${photo.temporal ? 'Nueva fotografía' : 'Fotografía actual'} de ${escapeHtml(deviceLabels[type])}"><p class="photo-info">${photo.temporal ? 'Nueva fotografía · se guardará al confirmar' : 'Fotografía actual'}</p>`
      : renderEmpty('Todavía no hay fotografía.');
    return `<section class="photo-card" data-edit-photo-card="${type}"><div class="photo-heading"><h3>${deviceLabels[type]}</h3><span class="helper">${photo ? (photo.temporal ? 'Nueva' : 'Actual') : 'Sin fotografía'}</span></div><div class="photo-preview">${preview}</div>${photoSourceControls(type, 'edit', Boolean(photo))}${photo ? `<button class="button button-danger edit-delete-photo" type="button" data-delete-edit-photo="${type}">ELIMINAR FOTO</button>` : ''}</section>`;
  }).join('') || renderEmpty('Seleccione al menos un dispositivo.');
}

function prepararEliminacionFotoEdicion(type) {
  const pending = editState?.pendingPhotos.get(type);
  if (pending?.url) liberarObjectUrl(pending.url);
  editState?.pendingPhotos.delete(type);
  const existing = editState?.existingImages.get(type);
  if (existing) {
    liberarObjectUrl(existing.url);
    existing.url = null;
    editState.deletedTypes.add(type);
  }
}

async function renderEdit(record) {
  const images = await obtenerImagenes(record.id);
  const latestByType = new Map();
  images.forEach((image) => {
    const current = latestByType.get(image.tipo);
    if (!current || new Date(image.fecha) >= new Date(current.fecha)) latestByType.set(image.tipo, image);
  });
  latestByType.forEach((image) => { image.url = crearObjectUrl(image.imagen); });
  editState = { existingImages: latestByType, pendingPhotos: new Map(), deletedTypes: new Set() };

  app.innerHTML = `<section class="hero"><h2>Editar registro</h2><p class="subtitle">Actualiza los datos, dispositivos y fotografías de esta gestión.</p></section>
    <form class="form-card" id="edit-ticket-form">
      <fieldset><legend>DATOS DE LA GESTIÓN</legend><div class="edit-data-fields">
        <div class="field"><label for="edit-ticket">Nombre de Gestión</label><input id="edit-ticket" name="ticket" type="text" required value="${escapeHtml(record.ticket)}"></div>
        <div class="field"><label for="edit-cliente">Nombre del cliente <span class="helper">(opcional)</span></label><input id="edit-cliente" name="cliente" value="${escapeHtml(record.cliente)}"></div>
        <div class="field"><label for="edit-telefono">Teléfono del cliente <span class="helper">(opcional)</span></label><input id="edit-telefono" name="telefono" type="tel" value="${escapeHtml(record.telefono)}"></div>
        <div class="field"><label for="edit-observaciones">Observaciones <span class="helper">(opcional)</span></label><textarea id="edit-observaciones" name="observaciones">${escapeHtml(record.observaciones || '')}</textarea></div>
      </div></fieldset>
      <fieldset><legend>DISPOSITIVOS / FOTOGRAFÍAS</legend><div class="device-grid">
        ${Object.entries(deviceLabels).map(([value, label]) => `<label class="device-option"><input type="checkbox" name="dispositivos" value="${value}" ${record.dispositivos?.[value] ? 'checked' : ''}><span>${label}</span></label>`).join('')}
      </div></fieldset>
      <div class="photo-list edit-photo-list" id="edit-photo-list"></div>
      <button class="button button-primary" type="submit">GUARDAR CAMBIOS</button>
    </form>`;
  renderEditPhotoBlocks();

  const form = document.querySelector('#edit-ticket-form');
  form.addEventListener('change', async (event) => {
    const input = event.target;
    if (input.matches('[data-photo-input][data-photo-context="edit"]')) {
      const file = input.files?.[0];
      await procesarArchivoFoto(file, input.dataset.photoInput, editState.pendingPhotos, (type) => {
        const existing = editState.existingImages.get(type);
        if (existing?.url) {
          liberarObjectUrl(existing.url);
          existing.url = null;
        }
        renderEditPhotoBlocks();
      });
      input.value = '';
      return;
    }
    if (!input.matches('input[name="dispositivos"]')) return;
    const type = input.value;
    if (!input.checked && fotoEfectivaEdicion(type)) {
      const confirmed = window.confirm(`${deviceLabels[type]} tiene una fotografía guardada.\n\nSi elimina este dispositivo de la gestión, también se eliminará su fotografía.\n\n¿Desea continuar?`);
      if (!confirmed) {
        input.checked = true;
        return;
      }
      prepararEliminacionFotoEdicion(type);
      showToast(`${deviceLabels[type]} y su fotografía se eliminarán al guardar.`);
    }
    renderEditPhotoBlocks();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selectedDevices = [...form.querySelectorAll('input[name="dispositivos"]:checked')].map((input) => input.value);
    if (!selectedDevices.length) {
      showToast('Debe seleccionar al menos un dispositivo.');
      return;
    }
    const changes = Object.fromEntries(new FormData(form).entries());
    changes.dispositivos = Object.fromEntries(Object.keys(deviceLabels).map((type) => [type, selectedDevices.includes(type)]));
    const fotos = [...editState.pendingPhotos].map(([tipo, photo]) => ({ tipo, imagen: photo.blob }));
    try {
      selectedRecord = await guardarEdicionCompleta({ ticket: { ...record, ...changes }, fotos, eliminarTipos: [...editState.deletedTypes] });
      showToast('Cambios guardados correctamente.');
      sincronizarEnSegundoPlano();
      await navigate('detail');
    } catch (error) {
      showToast(error.code === 'TICKET_DUPLICADO' ? error.message : 'Error al actualizar la información. No se aplicaron cambios incompletos.');
      if (error.code !== 'TICKET_DUPLICADO') console.error(error);
    }
  });
}

async function renderDetail(record) {
  selectedRecord = record;
  const devices = Object.entries(record.dispositivos || {}).filter(([, selected]) => selected).map(([type]) => deviceLabels[type]);
  const images = await obtenerImagenes(record.id);
  const gallery = images.length ? images.map((item) => {
    const imageUrl = crearObjectUrl(item.imagen);
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
    <div class="button-stack"><button class="button button-secondary" type="button" data-action="new-record">REGISTRAR OTRA GESTIÓN</button><button class="button button-secondary" type="button" data-action="edit-ticket">EDITAR</button>${stateAction}<button class="button button-danger" type="button" data-action="delete-ticket">ELIMINAR</button></div>`;
}

async function navigate(route) {
  const previousRoute = currentRoute;
  limpiarObjectUrls();
  if (previousRoute === 'capture' && route !== 'capture') pendingPhotos = new Map();
  if (previousRoute === 'edit') editState = null;
  currentRoute = route;
  title.textContent = route === 'new' ? 'Nuevo registro' : route === 'capture' ? 'Fotografías' : route === 'edit' ? 'Editar' : route === 'search' ? 'Buscar' : route === 'all' ? 'Registros' : route === 'settings' ? 'Configuración' : route === 'detail' ? 'Detalle' : 'Evidencias Soporte';
  backButton.hidden = route === 'home';
  document.querySelectorAll('.bottom-nav [data-route]').forEach((button) => button.classList.toggle('is-active', button.dataset.route === route));
  try {
    if (route === 'home') await renderHome();
    else if (route === 'new') renderNew();
    else if (route === 'capture') renderCapture(selectedRecord);
    else if (route === 'edit') await renderEdit(selectedRecord);
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

document.addEventListener('click', async (event) => {
  const routeButton = event.target.closest('[data-route]');
  if (routeButton) {
    if (routeButton.dataset.route === 'new') void iniciarNuevoRegistro();
    else void navigate(routeButton.dataset.route);
  }
  const recordButton = event.target.closest('[data-record-id]');
  if (recordButton) void obtenerTickets().then((tickets) => { selectedRecord = tickets.find((record) => record.id === recordButton.dataset.recordId); if (selectedRecord) return navigate('detail'); showToast('No se encontró el registro.'); }).catch(() => showToast('Error al abrir el registro.'));
  const deleteEditPhoto = event.target.closest('[data-delete-edit-photo]');
  if (deleteEditPhoto && editState) {
    const type = deleteEditPhoto.dataset.deleteEditPhoto;
    if (window.confirm(`¿Desea eliminar la fotografía de ${deviceLabels[type]}?`)) {
      prepararEliminacionFotoEdicion(type);
      renderEditPhotoBlocks();
      showToast('La fotografía se eliminará al guardar los cambios.');
    }
  }
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
    void restaurarRespaldo(pendingRestore, restoreMode.dataset.restoreMode).then(async () => { pendingRestore = null; document.querySelector('#restore-dialog')?.close(); showToast('Respaldo restaurado correctamente.'); sincronizarEnSegundoPlano(); await navigate('home'); }).catch((error) => { showToast(error.message || 'No se pudo restaurar el respaldo.'); console.error(error); });
  }
  if (event.target.closest('[data-close-restore]')) { pendingRestore = null; document.querySelector('#restore-dialog')?.close(); }
  if (event.target.closest('[data-action="new-record"]')) void iniciarNuevoRegistro();
  if (event.target.closest('[data-action="edit-ticket"]')) void navigate('edit');
  if (event.target.closest('[data-action="close-ticket"]')) {
    void cerrarTicket(selectedRecord.id).then(async (updated) => { selectedRecord = updated; showToast('Gestión marcada como cerrada.'); sincronizarEnSegundoPlano(); await navigate('detail'); }).catch((error) => { showToast('Error al cerrar la gestión.'); console.error(error); });
  }
  if (event.target.closest('[data-action="reopen-ticket"]')) {
    void reabrirTicket(selectedRecord.id).then(async (updated) => { selectedRecord = updated; showToast('Gestión reabierta correctamente.'); sincronizarEnSegundoPlano(); await navigate('detail'); }).catch((error) => { showToast('Error al reabrir la gestión.'); console.error(error); });
  }
  if (event.target.closest('[data-action="delete-ticket"]')) {
    if (!selectedRecord || !window.confirm('¿Está seguro de eliminar este registro?\n\nTambién se eliminarán todas sus fotografías.')) return;
    void eliminarTicket(selectedRecord.id).then(async () => { selectedRecord = null; showToast('Registro eliminado correctamente.'); sincronizarEnSegundoPlano(); await navigate('home'); }).catch((error) => { showToast('Error al eliminar el registro.'); console.error(error); });
  }
  if (event.target.closest('[data-action="save-server"]')) {
    try {
      guardarApiBaseUrl(document.querySelector('#api-base-url')?.value);
      showToast('Configuración del servidor guardada.');
      await navigate('settings');
      sincronizarEnSegundoPlano();
    } catch (error) { showToast(error.message); }
  }
  if (event.target.closest('[data-action="sync-now"]')) {
    const routeAtStart = currentRoute;
    showToast('Sincronizando datos...');
    void sincronizar().then(async (result) => { showToast(result.errores ? `Sincronización parcial: ${result.errores} error(es), ${result.pendientes} pendiente(s).` : 'Sincronización completada.'); if (currentRoute === routeAtStart) await navigate(routeAtStart); }).catch((error) => { showToast(error.message || 'No se pudo sincronizar.'); });
  }
  if (event.target.closest('[data-action="sync-existing"]')) {
    if (!window.confirm('Se prepararán todos los registros y fotografías locales para subirlos al servidor. Los UUID se conservarán. ¿Desea continuar?')) return;
    showToast('Preparando y sincronizando datos existentes...');
    void sincronizarDatosExistentes().then(async (result) => { showToast(`Enviados: ${result.ticketsEnviados} registros, ${result.imagenesEnviadas} fotografías. Omitidos: ${result.omitidos}. Errores: ${result.errores}.`); await navigate('settings'); }).catch((error) => { showToast(error.message || 'No se pudieron sincronizar los datos existentes.'); });
  }
  if (event.target.closest('[data-action="planned"]')) showToast('Esta función se implementará en una etapa posterior.');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch((error) => console.error('No se pudo registrar el modo offline.', error)));
}

iniciarSincronizacionAutomatica();
observarSincronizacion(() => {
  if (currentRoute === 'settings' || currentRoute === 'home') void navigate(currentRoute);
});
void navigate('home');

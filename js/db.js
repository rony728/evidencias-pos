// Capa de persistencia local. La red se maneja exclusivamente desde sync.js.
const DB_NAME = 'evidencias-soporte-db';
const DB_VERSION = 2;
const TICKETS_STORE = 'tickets';
const IMAGES_STORE = 'imagenes';
const PENDING_STORE = 'operacionesPendientes';

let databasePromise;

function abrirBaseDatos() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const tickets = database.objectStoreNames.contains(TICKETS_STORE)
        ? request.transaction.objectStore(TICKETS_STORE)
        : database.createObjectStore(TICKETS_STORE, { keyPath: 'id' });

      if (!tickets.indexNames.contains('porTicket')) {
        tickets.createIndex('porTicket', 'ticketNormalizado', { unique: true });
      }
      if (!tickets.indexNames.contains('porEstado')) {
        tickets.createIndex('porEstado', 'estado', { unique: false });
      }
      // Se crea desde ahora para que la Etapa 3 pueda guardar fotografías sin migración adicional.
      if (!database.objectStoreNames.contains(IMAGES_STORE)) {
        const images = database.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
        images.createIndex('porTicket', 'ticketId', { unique: false });
        images.createIndex('porTipo', ['ticketId', 'tipo'], { unique: false });
      }
      // La actualización a v2 solo agrega la cola: los datos existentes permanecen intactos.
      if (!database.objectStoreNames.contains(PENDING_STORE)) {
        const pending = database.createObjectStore(PENDING_STORE, { keyPath: 'id' });
        pending.createIndex('porFecha', 'fechaCreacion', { unique: false });
        pending.createIndex('porTipo', 'tipo', { unique: false });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'));
    request.onblocked = () => reject(new Error('La base de datos está siendo usada por otra ventana.'));
  });

  return databasePromise;
}

function ejecutar(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Error en IndexedDB.'));
  });
}

function completarTransaccion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Error en IndexedDB.'));
    transaction.onabort = () => reject(transaction.error || new Error('La operación local fue cancelada.'));
  });
}

function operacionPendiente(tipo, entidadId, datos = {}) {
  return {
    id: `${tipo}:${entidadId}`,
    tipo,
    entidadId,
    datos,
    fechaCreacion: new Date().toISOString(),
    intentos: 0,
    ultimoError: null
  };
}

function nuevoId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('Este navegador no permite generar UUID seguros.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nuevoIdInterno() {
  return nuevoId();
}

function prepararTicket(ticket, conservarFechaModificacion = false) {
  const ahora = new Date().toISOString();
  const dispositivos = {
    pos: Boolean(ticket.dispositivos?.pos),
    sim: Boolean(ticket.dispositivos?.sim),
    lectora: Boolean(ticket.dispositivos?.lectora),
    token: Boolean(ticket.dispositivos?.token),
    powerbank: Boolean(ticket.dispositivos?.powerbank),
    otros: Boolean(ticket.dispositivos?.otros)
  };

  return {
    id: ticket.id || nuevoId(),
    ticket: String(ticket.ticket || '').trim(),
    ticketNormalizado: String(ticket.ticket || '').trim().toLocaleLowerCase(),
    cliente: String(ticket.cliente || '').trim(),
    telefono: String(ticket.telefono || '').trim(),
    observaciones: String(ticket.observaciones || '').trim(),
    fechaCreacion: ticket.fechaCreacion || ahora,
    fechaModificacion: conservarFechaModificacion && ticket.fechaModificacion ? ticket.fechaModificacion : ahora,
    estado: ticket.estado || 'pendiente',
    fechaCierre: Object.prototype.hasOwnProperty.call(ticket, 'fechaCierre') ? ticket.fechaCierre : null,
    dispositivos,
    syncStatus: ticket.syncStatus || 'pendiente',
    ultimaSincronizacion: ticket.ultimaSincronizacion || null,
    errorSincronizacion: null
  };
}

function validarTicket(ticket) {
  if (!ticket.ticket) {
    const validationError = new Error('El nombre de gestión es obligatorio.');
    validationError.code = 'DATOS_INCOMPLETOS';
    throw validationError;
  }
  if (!Object.values(ticket.dispositivos).some(Boolean)) {
    const validationError = new Error('Debe seleccionar al menos un dispositivo.');
    validationError.code = 'SIN_DISPOSITIVOS';
    throw validationError;
  }
}

export async function crearTicket(datos) {
  const database = await abrirBaseDatos();
  const ticket = prepararTicket(datos);
  validarTicket(ticket);
  try {
    const transaction = database.transaction([TICKETS_STORE, PENDING_STORE], 'readwrite');
    transaction.objectStore(TICKETS_STORE).add(ticket);
    transaction.objectStore(PENDING_STORE).put(operacionPendiente('ticket-upsert', ticket.id));
    await completarTransaccion(transaction);
    return ticket;
  } catch (error) {
    if (error.name === 'ConstraintError') {
      const duplicateError = new Error('Ya existe un registro con este nombre de gestión.');
      duplicateError.code = 'TICKET_DUPLICADO';
      throw duplicateError;
    }
    throw error;
  }
}

export async function obtenerTicket(id) {
  const database = await abrirBaseDatos();
  return ejecutar(database.transaction(TICKETS_STORE, 'readonly').objectStore(TICKETS_STORE).get(id));
}

export async function obtenerTickets() {
  const database = await abrirBaseDatos();
  const tickets = await ejecutar(database.transaction(TICKETS_STORE, 'readonly').objectStore(TICKETS_STORE).getAll());
  return tickets.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
}

export async function actualizarTicket(datos) {
  if (!datos?.id) throw new Error('El ticket que se desea actualizar no tiene ID.');
  const database = await abrirBaseDatos();
  const ticket = prepararTicket(datos);
  validarTicket(ticket);
  try {
    const transaction = database.transaction([TICKETS_STORE, PENDING_STORE], 'readwrite');
    transaction.objectStore(TICKETS_STORE).put(ticket);
    transaction.objectStore(PENDING_STORE).put(operacionPendiente('ticket-upsert', ticket.id));
    await completarTransaccion(transaction);
    return ticket;
  } catch (error) {
    if (error.name === 'ConstraintError') {
      const duplicateError = new Error('Ya existe otro registro con este nombre de gestión.');
      duplicateError.code = 'TICKET_DUPLICADO';
      throw duplicateError;
    }
    throw error;
  }
}

export async function eliminarTicket(id) {
  const database = await abrirBaseDatos();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([TICKETS_STORE, IMAGES_STORE, PENDING_STORE], 'readwrite');
    const ticketStore = transaction.objectStore(TICKETS_STORE);
    const imagesStore = transaction.objectStore(IMAGES_STORE);
    const pendingStore = transaction.objectStore(PENDING_STORE);
    const keysRequest = imagesStore.index('porTicket').getAllKeys(id);

    keysRequest.onsuccess = () => {
      keysRequest.result.forEach((imageId) => {
        imagesStore.delete(imageId);
        pendingStore.delete(`image-create:${imageId}`);
        pendingStore.delete(`image-delete:${imageId}`);
      });
      ticketStore.delete(id);
      pendingStore.delete(`ticket-upsert:${id}`);
      pendingStore.put(operacionPendiente('ticket-delete', id));
    };
    keysRequest.onerror = () => reject(keysRequest.error || new Error('No se pudieron localizar las fotografías.'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo eliminar el registro.'));
    transaction.onabort = () => reject(transaction.error || new Error('La eliminación fue cancelada.'));
  });
}

// Replica una eliminación remota sin crear otra operación de subida.
export async function eliminarTicketDesdeServidor(id) {
  const database = await abrirBaseDatos();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([TICKETS_STORE, IMAGES_STORE, PENDING_STORE], 'readwrite');
    const imagesStore = transaction.objectStore(IMAGES_STORE);
    const pendingStore = transaction.objectStore(PENDING_STORE);
    const keysRequest = imagesStore.index('porTicket').getAllKeys(id);
    keysRequest.onsuccess = () => {
      keysRequest.result.forEach((imageId) => {
        imagesStore.delete(imageId);
        pendingStore.delete(`image-create:${imageId}`);
      });
      transaction.objectStore(TICKETS_STORE).delete(id);
      pendingStore.delete(`ticket-upsert:${id}`);
      pendingStore.delete(`ticket-delete:${id}`);
    };
    keysRequest.onerror = () => reject(keysRequest.error || new Error('No se pudo aplicar la eliminación remota.'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo aplicar la eliminación remota.'));
    transaction.onabort = () => reject(transaction.error || new Error('La eliminación remota fue cancelada.'));
  });
}

export async function buscarTickets(termino = '') {
  const query = String(termino).trim().toLocaleLowerCase();
  const tickets = await obtenerTickets();
  if (!query) return tickets;
  return tickets.filter((ticket) => [ticket.ticket, ticket.cliente, ticket.telefono].some((value) => String(value).toLocaleLowerCase().includes(query)));
}

export async function obtenerPendientes() {
  const tickets = await obtenerTickets();
  return tickets.filter((ticket) => ticket.estado === 'pendiente');
}

export async function cerrarTicket(id) {
  const ticket = await obtenerTicket(id);
  if (!ticket) throw new Error('No se encontró el ticket.');
  return actualizarTicket({ ...ticket, estado: 'cerrado', fechaCierre: new Date().toISOString() });
}

export async function reabrirTicket(id) {
  const ticket = await obtenerTicket(id);
  if (!ticket) throw new Error('No se encontró el ticket.');
  return actualizarTicket({ ...ticket, estado: 'pendiente', fechaCierre: null });
}

export async function crearImagen(datos) {
  if (!datos?.ticketId || !datos?.tipo || !(datos.imagen instanceof Blob)) {
    throw new Error('La fotografía no tiene los datos requeridos.');
  }
  const database = await abrirBaseDatos();
  const imagen = {
    id: datos.id || nuevoId(),
    ticketId: datos.ticketId,
    tipo: datos.tipo,
    imagen: datos.imagen,
    fecha: datos.fecha || new Date().toISOString(),
    syncStatus: 'pendiente',
    ultimaSincronizacion: null,
    errorSincronizacion: null
  };
  const transaction = database.transaction([IMAGES_STORE, PENDING_STORE], 'readwrite');
  transaction.objectStore(IMAGES_STORE).add(imagen);
  transaction.objectStore(PENDING_STORE).put(operacionPendiente('image-create', imagen.id, { ticketId: imagen.ticketId }));
  await completarTransaccion(transaction);
  return imagen;
}

export async function obtenerImagen(id) {
  const database = await abrirBaseDatos();
  return ejecutar(database.transaction(IMAGES_STORE, 'readonly').objectStore(IMAGES_STORE).get(id));
}

export async function obtenerImagenes(ticketId) {
  const database = await abrirBaseDatos();
  const store = database.transaction(IMAGES_STORE, 'readonly').objectStore(IMAGES_STORE);
  const imagenes = await ejecutar(store.index('porTicket').getAll(ticketId));
  return imagenes.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

export async function obtenerTodasImagenes() {
  const database = await abrirBaseDatos();
  return ejecutar(database.transaction(IMAGES_STORE, 'readonly').objectStore(IMAGES_STORE).getAll());
}

export async function restaurarDatos({ tickets = [], imagenes = [], modo = 'combinar' }) {
  const database = await abrirBaseDatos();
  const existentes = await obtenerTickets();
  const imagenesExistentes = await obtenerTodasImagenes();
  const ticketsPorId = new Set(existentes.map((ticket) => ticket.id));
  const numerosExistentes = new Set(existentes.map((ticket) => ticket.ticketNormalizado));
  const imagenesPorId = new Set(imagenesExistentes.map((imagen) => imagen.id));
  const ticketsImportados = tickets.map((ticket) => ({
    ...prepararTicket(ticket, true),
    syncStatus: 'pendiente',
    ultimaSincronizacion: null
  }));
  const imagenesImportadas = imagenes
    .filter((imagen) => imagen?.ticketId && imagen?.imagen instanceof Blob)
    .map((imagen) => ({ ...imagen, syncStatus: 'pendiente', ultimaSincronizacion: null, errorSincronizacion: null }));

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([TICKETS_STORE, IMAGES_STORE, PENDING_STORE], 'readwrite');
    const ticketStore = transaction.objectStore(TICKETS_STORE);
    const imageStore = transaction.objectStore(IMAGES_STORE);
    const pendingStore = transaction.objectStore(PENDING_STORE);
    const idsDisponibles = new Set(ticketsPorId);

    if (modo === 'reemplazar') {
      ticketStore.clear();
      imageStore.clear();
      pendingStore.clear();
      const importedIds = new Set(ticketsImportados.map((ticket) => ticket.id));
      existentes
        .filter((ticket) => !importedIds.has(ticket.id))
        .forEach((ticket) => pendingStore.put(operacionPendiente('ticket-delete', ticket.id)));
    }

    for (const ticket of ticketsImportados) {
      if (modo === 'combinar' && (ticketsPorId.has(ticket.id) || numerosExistentes.has(ticket.ticketNormalizado))) continue;
      ticketStore.put(ticket);
      pendingStore.put(operacionPendiente('ticket-upsert', ticket.id));
      idsDisponibles.add(ticket.id);
      numerosExistentes.add(ticket.ticketNormalizado);
    }

    for (const imagen of imagenesImportadas) {
      if (modo === 'combinar' && imagenesPorId.has(imagen.id)) continue;
      if (!idsDisponibles.has(imagen.ticketId)) continue;
      imageStore.put(imagen);
      pendingStore.put(operacionPendiente('image-create', imagen.id, { ticketId: imagen.ticketId }));
      imagenesPorId.add(imagen.id);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo restaurar el respaldo.'));
    transaction.onabort = () => reject(transaction.error || new Error('La restauración fue cancelada.'));
  });
}

export async function obtenerOperacionesPendientes() {
  const database = await abrirBaseDatos();
  const operations = await ejecutar(database.transaction(PENDING_STORE, 'readonly').objectStore(PENDING_STORE).getAll());
  return operations.sort((a, b) => new Date(a.fechaCreacion) - new Date(b.fechaCreacion));
}

export async function contarPendientesSincronizacion() {
  const database = await abrirBaseDatos();
  return ejecutar(database.transaction(PENDING_STORE, 'readonly').objectStore(PENDING_STORE).count());
}

export async function completarOperacion(id) {
  const database = await abrirBaseDatos();
  await ejecutar(database.transaction(PENDING_STORE, 'readwrite').objectStore(PENDING_STORE).delete(id));
}

export async function marcarOperacionError(id, error) {
  const database = await abrirBaseDatos();
  const current = await ejecutar(database.transaction(PENDING_STORE, 'readonly').objectStore(PENDING_STORE).get(id));
  if (!current) return;
  const updated = {
    ...current,
    intentos: (current.intentos || 0) + 1,
    ultimoError: String(error?.message || error || 'Error desconocido'),
    ultimoIntento: new Date().toISOString()
  };
  await ejecutar(database.transaction(PENDING_STORE, 'readwrite').objectStore(PENDING_STORE).put(updated));
}

// Aplica la copia elegida por el servidor sin crear una nueva operación pendiente.
export async function aplicarTicketServidor(ticket) {
  if (!ticket?.id) return;
  const database = await abrirBaseDatos();
  const local = await obtenerTicket(ticket.id);
  if (local && new Date(local.fechaModificacion) > new Date(ticket.fechaModificacion)) return;
  const serverTicket = {
    ...ticket,
    ticketNormalizado: String(ticket.ticket || '').trim().toLocaleLowerCase(),
    syncStatus: 'sincronizado',
    ultimaSincronizacion: new Date().toISOString(),
    errorSincronizacion: null
  };
  await ejecutar(database.transaction(TICKETS_STORE, 'readwrite').objectStore(TICKETS_STORE).put(serverTicket));
}

export async function marcarImagenSincronizada(id) {
  const database = await abrirBaseDatos();
  const current = await obtenerImagen(id);
  if (!current) return;
  await ejecutar(database.transaction(IMAGES_STORE, 'readwrite').objectStore(IMAGES_STORE).put({
    ...current,
    syncStatus: 'sincronizado',
    ultimaSincronizacion: new Date().toISOString(),
    errorSincronizacion: null
  }));
}

export async function aplicarImagenServidor(imagen) {
  if (!imagen?.id || !(imagen.imagen instanceof Blob)) return;
  const database = await abrirBaseDatos();
  await ejecutar(database.transaction(IMAGES_STORE, 'readwrite').objectStore(IMAGES_STORE).put({
    ...imagen,
    syncStatus: 'sincronizado',
    ultimaSincronizacion: new Date().toISOString(),
    errorSincronizacion: null
  }));
}

// Migración explícita e idempotente: conserva UUID y contenido de todos los datos locales.
export async function marcarDatosExistentesPendientes() {
  const database = await abrirBaseDatos();
  const [tickets, imagenes] = await Promise.all([obtenerTickets(), obtenerTodasImagenes()]);
  const transaction = database.transaction([TICKETS_STORE, IMAGES_STORE, PENDING_STORE], 'readwrite');
  const ticketStore = transaction.objectStore(TICKETS_STORE);
  const imageStore = transaction.objectStore(IMAGES_STORE);
  const pendingStore = transaction.objectStore(PENDING_STORE);

  tickets.forEach((ticket) => {
    ticketStore.put({ ...ticket, syncStatus: 'pendiente', errorSincronizacion: null });
    pendingStore.put(operacionPendiente('ticket-upsert', ticket.id));
  });
  imagenes.forEach((imagen) => {
    imageStore.put({ ...imagen, syncStatus: 'pendiente', errorSincronizacion: null });
    pendingStore.put(operacionPendiente('image-create', imagen.id, { ticketId: imagen.ticketId }));
  });
  await completarTransaccion(transaction);
  return { tickets: tickets.length, imagenes: imagenes.length };
}

export async function obtenerResumenAlmacenamiento() {
  const [tickets, imagenes] = await Promise.all([obtenerTickets(), obtenerTodasImagenes()]);
  const bytes = imagenes.reduce((total, imagen) => total + (imagen.imagen?.size || 0), 0);
  return { tickets: tickets.length, imagenes: imagenes.length, bytes }; 
}

export async function eliminarCerradosAntiguos(dias) {
  const days = Number(dias);
  if (!Number.isFinite(days) || days <= 0) return 0;
  const limite = Date.now() - days * 24 * 60 * 60 * 1000;
  const tickets = await obtenerTickets();
  const antiguos = tickets.filter((ticket) => ticket.estado === 'cerrado' && ticket.fechaCierre && new Date(ticket.fechaCierre).getTime() <= limite);
  for (const ticket of antiguos) await eliminarTicket(ticket.id);
  return antiguos.length;
}

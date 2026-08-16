// Capa de persistencia local. No realiza conexiones de red.
const DB_NAME = 'evidencias-soporte-db';
const DB_VERSION = 1;
const TICKETS_STORE = 'tickets';
const IMAGES_STORE = 'imagenes';

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

function nuevoId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nuevoIdInterno() {
  return nuevoId();
}

function prepararTicket(ticket) {
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
    fechaModificacion: ahora,
    estado: ticket.estado || 'pendiente',
    fechaCierre: Object.prototype.hasOwnProperty.call(ticket, 'fechaCierre') ? ticket.fechaCierre : null,
    dispositivos
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
    await ejecutar(database.transaction(TICKETS_STORE, 'readwrite').objectStore(TICKETS_STORE).add(ticket));
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
    await ejecutar(database.transaction(TICKETS_STORE, 'readwrite').objectStore(TICKETS_STORE).put(ticket));
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
    const transaction = database.transaction([TICKETS_STORE, IMAGES_STORE], 'readwrite');
    const ticketStore = transaction.objectStore(TICKETS_STORE);
    const imagesStore = transaction.objectStore(IMAGES_STORE);
    const keysRequest = imagesStore.index('porTicket').getAllKeys(id);

    keysRequest.onsuccess = () => {
      keysRequest.result.forEach((imageId) => imagesStore.delete(imageId));
      ticketStore.delete(id);
    };
    keysRequest.onerror = () => reject(keysRequest.error || new Error('No se pudieron localizar las fotografías.'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo eliminar el registro.'));
    transaction.onabort = () => reject(transaction.error || new Error('La eliminación fue cancelada.'));
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
    fecha: datos.fecha || new Date().toISOString()
  };
  await ejecutar(database.transaction(IMAGES_STORE, 'readwrite').objectStore(IMAGES_STORE).add(imagen));
  return imagen;
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
  const existentes = modo === 'combinar' ? await obtenerTickets() : [];
  const imagenesExistentes = modo === 'combinar' ? await obtenerTodasImagenes() : [];
  const ticketsPorId = new Set(existentes.map((ticket) => ticket.id));
  const numerosExistentes = new Set(existentes.map((ticket) => ticket.ticketNormalizado));
  const imagenesPorId = new Set(imagenesExistentes.map((imagen) => imagen.id));
  const ticketsImportados = tickets.map((ticket) => prepararTicket(ticket));
  const imagenesImportadas = imagenes.filter((imagen) => imagen?.ticketId && imagen?.imagen instanceof Blob);

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([TICKETS_STORE, IMAGES_STORE], 'readwrite');
    const ticketStore = transaction.objectStore(TICKETS_STORE);
    const imageStore = transaction.objectStore(IMAGES_STORE);
    const idsDisponibles = new Set(ticketsPorId);

    if (modo === 'reemplazar') {
      ticketStore.clear();
      imageStore.clear();
    }

    for (const ticket of ticketsImportados) {
      if (modo === 'combinar' && (ticketsPorId.has(ticket.id) || numerosExistentes.has(ticket.ticketNormalizado))) continue;
      ticketStore.put(ticket);
      idsDisponibles.add(ticket.id);
      numerosExistentes.add(ticket.ticketNormalizado);
    }

    for (const imagen of imagenesImportadas) {
      if (modo === 'combinar' && imagenesPorId.has(imagen.id)) continue;
      if (!idsDisponibles.has(imagen.ticketId)) continue;
      imageStore.put(imagen);
      imagenesPorId.add(imagen.id);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo restaurar el respaldo.'));
    transaction.onabort = () => reject(transaction.error || new Error('La restauración fue cancelada.'));
  });
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

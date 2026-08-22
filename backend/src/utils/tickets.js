const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TYPES = ['pos', 'sim', 'lectora', 'token', 'powerbank', 'otros'];

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || ''));
}

export function normalizeManagementName(value) {
  return String(value || '').trim().toLocaleLowerCase('es');
}

export function normalizeTicket(payload = {}) {
  const now = new Date().toISOString();
  const ticket = String(payload.ticket || '').trim();
  const estado = payload.estado === 'cerrado' ? 'cerrado' : 'pendiente';
  const dispositivos = Object.fromEntries(DEVICE_TYPES.map((type) => [type, Boolean(payload.dispositivos?.[type])]));
  const normalized = {
    id: String(payload.id || ''),
    ticket,
    ticketNormalizado: normalizeManagementName(payload.ticketNormalizado || ticket),
    cliente: String(payload.cliente || '').trim(),
    telefono: String(payload.telefono || '').trim(),
    observaciones: String(payload.observaciones || '').trim(),
    estado,
    fechaCreacion: payload.fechaCreacion || now,
    fechaModificacion: payload.fechaModificacion || now,
    fechaCierre: estado === 'cerrado' ? (payload.fechaCierre || payload.fechaModificacion || now) : null,
    dispositivos
  };

  if (!isUuid(normalized.id)) throw Object.assign(new Error('El ID del registro no es un UUID válido.'), { status: 400 });
  if (!normalized.ticket) throw Object.assign(new Error('El nombre de gestión es obligatorio.'), { status: 400 });
  if (!Object.values(dispositivos).some(Boolean)) throw Object.assign(new Error('Debe existir al menos un dispositivo seleccionado.'), { status: 400 });
  if (Number.isNaN(Date.parse(normalized.fechaCreacion)) || Number.isNaN(Date.parse(normalized.fechaModificacion))) {
    throw Object.assign(new Error('Las fechas del registro no son válidas.'), { status: 400 });
  }
  return normalized;
}

export function ticketParams(ticket) {
  return [
    ticket.id, ticket.ticket, ticket.ticketNormalizado, ticket.cliente, ticket.telefono,
    ticket.observaciones, ticket.estado, ticket.fechaCreacion, ticket.fechaModificacion,
    ticket.fechaCierre, ticket.dispositivos.pos, ticket.dispositivos.sim,
    ticket.dispositivos.lectora, ticket.dispositivos.token,
    ticket.dispositivos.powerbank, ticket.dispositivos.otros
  ];
}

export const TICKET_SELECT = `
  id,
  ticket,
  ticket_normalizado AS "ticketNormalizado",
  cliente,
  telefono,
  observaciones,
  estado,
  fecha_creacion AS "fechaCreacion",
  fecha_modificacion AS "fechaModificacion",
  fecha_cierre AS "fechaCierre",
  json_build_object(
    'pos', dispositivo_pos,
    'sim', dispositivo_sim,
    'lectora', dispositivo_lectora,
    'token', dispositivo_token,
    'powerbank', dispositivo_powerbank,
    'otros', dispositivo_otros
  ) AS dispositivos`;

export const VALID_IMAGE_TYPES = new Set(DEVICE_TYPES);

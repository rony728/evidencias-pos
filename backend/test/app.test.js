import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const ID = '11111111-1111-4111-8111-111111111111';
const IMAGE_ID = '22222222-2222-4222-8222-222222222222';

function fakeTicket(overrides = {}) {
  return {
    id: ID,
    ticket: 'Cambio POS Central',
    ticketNormalizado: 'cambio pos central',
    cliente: '',
    telefono: '',
    observaciones: '',
    estado: 'pendiente',
    fechaCreacion: '2026-08-21T12:00:00.000Z',
    fechaModificacion: '2026-08-21T12:00:00.000Z',
    fechaCierre: null,
    dispositivos: { pos: true, sim: false, lectora: false, token: false, powerbank: false, otros: false },
    ...overrides
  };
}

function createFakeDatabase() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (sql.includes('INSERT INTO tickets')) return { rows: [fakeTicket()], rowCount: 1 };
      if (sql.includes('INSERT INTO imagenes')) return { rows: [{ id: IMAGE_ID, ticketId: ID, tipo: 'pos', mimeType: 'image/jpeg', fecha: '2026-08-21T12:00:00.000Z' }], rowCount: 1 };
      if (sql.includes('SELECT imagen, mime_type')) return { rows: [{ imagen: Buffer.from([255, 216, 255, 217]), mime_type: 'image/jpeg' }], rowCount: 1 };
      if (sql.includes('FROM tickets WHERE id')) return { rows: [fakeTicket()], rowCount: 1 };
      if (sql.includes('FROM tickets ORDER BY')) return { rows: [fakeTicket()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };
}

async function withServer(run) {
  const database = createFakeDatabase();
  const app = createApp({ database, env: { CORS_ORIGIN: 'https://rony728.github.io' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, database);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/health comprueba la base de datos', async () => {
  await withServer(async (baseUrl, database) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
    assert.match(database.calls[0].sql, /SELECT 1/);
  });
});

test('GET /api/tickets devuelve registros y eliminaciones sincronizables', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tickets[0].id, ID);
    assert.deepEqual(body.eliminados, []);
  });
});

test('POST /api/tickets conserva UUID y usa parámetros SQL', async () => {
  await withServer(async (baseUrl, database) => {
    const response = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://rony728.github.io' },
      body: JSON.stringify(fakeTicket())
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.ticket.id, ID);
    const insert = database.calls.find((call) => call.sql.includes('INSERT INTO tickets'));
    assert.match(insert.sql, /\$1/);
    assert.equal(insert.params[0], ID);
    assert.equal(insert.params[1], 'Cambio POS Central');
  });
});

test('POST de imagen recibe multipart y entrega metadatos', async () => {
  await withServer(async (baseUrl, database) => {
    const form = new FormData();
    form.set('id', IMAGE_ID);
    form.set('tipo', 'pos');
    form.set('fecha', '2026-08-21T12:00:00.000Z');
    form.set('imagen', new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' }), 'pos.jpg');
    const response = await fetch(`${baseUrl}/api/tickets/${ID}/imagenes`, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.imagen.id, IMAGE_ID);
    const insert = database.calls.find((call) => call.sql.includes('INSERT INTO imagenes'));
    assert.ok(Buffer.isBuffer(insert.params[3]));
  });
});

test('GET de imagen entrega el Blob con su tipo MIME', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/imagenes/${IMAGE_ID}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal((await response.arrayBuffer()).byteLength, 4);
  });
});

test('DELETE de imagen utiliza el UUID y responde de forma idempotente', async () => {
  await withServer(async (baseUrl, database) => {
    const response = await fetch(`${baseUrl}/api/imagenes/${IMAGE_ID}`, { method: 'DELETE' });
    assert.equal(response.status, 204);
    const deletion = database.calls.find((call) => call.sql === 'DELETE FROM imagenes WHERE id = $1');
    assert.deepEqual(deletion.params, [IMAGE_ID]);
  });
});

test('DELETE de ticket registra tombstone antes de borrar', async () => {
  await withServer(async (baseUrl, database) => {
    const response = await fetch(`${baseUrl}/api/tickets/${ID}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fechaEliminacion: '2026-08-21T13:00:00.000Z' })
    });
    assert.equal(response.status, 204);
    const tombstone = database.calls.find((call) => call.sql.includes('INSERT INTO tickets_eliminados'));
    const deletion = database.calls.find((call) => call.sql === 'DELETE FROM tickets WHERE id = $1');
    assert.equal(tombstone.params[0], ID);
    assert.ok(database.calls.indexOf(tombstone) < database.calls.indexOf(deletion));
  });
});

test('POST /api/sync procesa cambios en una transacción', async () => {
  await withServer(async (baseUrl, database) => {
    const response = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickets: [fakeTicket()], deletedTicketIds: [] })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tickets[0].ticket.id, ID);
    assert.ok(database.calls.some((call) => call.sql === 'BEGIN'));
    assert.ok(database.calls.some((call) => call.sql === 'COMMIT'));
  });
});

test('CORS rechaza un origen no autorizado', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://example.com' } });
    assert.equal(response.status, 403);
  });
});

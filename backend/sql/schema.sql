BEGIN;

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY,
    ticket TEXT NOT NULL,
    ticket_normalizado TEXT NOT NULL UNIQUE,
    cliente TEXT NOT NULL DEFAULT '',
    telefono TEXT NOT NULL DEFAULT '',
    observaciones TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'cerrado')),
    fecha_creacion TIMESTAMPTZ NOT NULL,
    fecha_modificacion TIMESTAMPTZ NOT NULL,
    fecha_cierre TIMESTAMPTZ,
    dispositivo_pos BOOLEAN NOT NULL DEFAULT FALSE,
    dispositivo_sim BOOLEAN NOT NULL DEFAULT FALSE,
    dispositivo_lectora BOOLEAN NOT NULL DEFAULT FALSE,
    dispositivo_token BOOLEAN NOT NULL DEFAULT FALSE,
    dispositivo_powerbank BOOLEAN NOT NULL DEFAULT FALSE,
    dispositivo_otros BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (
        dispositivo_pos OR dispositivo_sim OR dispositivo_lectora OR
        dispositivo_token OR dispositivo_powerbank OR dispositivo_otros
    ),
    CHECK (
        (estado = 'pendiente' AND fecha_cierre IS NULL) OR
        (estado = 'cerrado' AND fecha_cierre IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS imagenes (
    id UUID PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('pos', 'sim', 'lectora', 'token', 'powerbank', 'otros')),
    imagen BYTEA NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    fecha TIMESTAMPTZ NOT NULL
);

-- Conserva eliminaciones para impedir que un cliente offline restaure datos obsoletos.
CREATE TABLE IF NOT EXISTS tickets_eliminados (
    id UUID PRIMARY KEY,
    fecha_eliminacion TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_estado_fecha
    ON tickets (estado, fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_fecha_modificacion
    ON tickets (fecha_modificacion DESC);

CREATE INDEX IF NOT EXISTS idx_imagenes_ticket_id
    ON imagenes (ticket_id);

CREATE INDEX IF NOT EXISTS idx_imagenes_ticket_tipo
    ON imagenes (ticket_id, tipo);

CREATE INDEX IF NOT EXISTS idx_tickets_eliminados_fecha
    ON tickets_eliminados (fecha_eliminacion DESC);

COMMIT;

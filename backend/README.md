# Backend de Evidencias POS

API REST privada para sincronizar la PWA con PostgreSQL. Usa Node.js, Express, `pg`, `cors`, `dotenv` y `multer`; las fotografías se reciben por `multipart/form-data` y se guardan como `BYTEA`.

## Preparar Termux

```bash
pkg update
pkg install nodejs-lts postgresql git
termux-setup-storage
```

Inicialice PostgreSQL la primera vez:

```bash
mkdir -p $PREFIX/var/lib/postgresql
initdb $PREFIX/var/lib/postgresql
pg_ctl -D $PREFIX/var/lib/postgresql start
createdb evidencias_pos
createuser evidencias_user
psql evidencias_pos
```

Dentro de `psql`, asigne una contraseña y permisos:

```sql
ALTER USER evidencias_user WITH PASSWORD 'CAMBIE_ESTA_CLAVE';
GRANT ALL PRIVILEGES ON DATABASE evidencias_pos TO evidencias_user;
GRANT ALL ON SCHEMA public TO evidencias_user;
\q
```

Clone el repositorio, instale dependencias y cree la estructura:

```bash
git clone https://github.com/rony728/evidencias-pos.git
cd evidencias-pos/backend
npm install
cp .env.example .env
psql -U evidencias_user -d evidencias_pos -f sql/schema.sql
```

Edite `.env` solo en el teléfono:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=evidencias_pos
DB_USER=evidencias_user
DB_PASSWORD=una-clave-segura
PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=https://rony728.github.io
```

`.env`, certificados y `node_modules` están excluidos de Git.

## HTTPS

GitHub Pages no puede llamar una API HTTP por contenido mixto. El backend admite TLS directo si se configuran ambos archivos:

```dotenv
TLS_CERT_PATH=/ruta/fullchain.pem
TLS_KEY_PATH=/ruta/privkey.pem
```

El certificado debe ser válido, confiable por Android y coincidir con el nombre usado en la URL. Para producción puede usarse un dominio propio con certificado público o un proxy HTTPS delante de Node. No confirme la conexión en la PWA hasta que `https://SU_HOST/api/health` abra sin advertencias en Chrome.

Para desarrollo en el mismo equipo se permite `http://localhost:3000`; esa excepción no funciona desde GitHub Pages.

## Iniciar y comprobar

```bash
npm start
curl http://127.0.0.1:3000/api/health
npm test
```

Respuesta esperada de salud:

```json
{"status":"ok","database":"connected"}
```

Para mantener PostgreSQL y Node activos en Termux, desactive la optimización de batería para Termux y use `termux-wake-lock`. Un gestor como PM2 puede añadirse posteriormente, pero no es necesario para ejecutar la aplicación.

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/health` | Salud de API y PostgreSQL |
| GET | `/api/tickets` | Tickets y tombstones |
| GET | `/api/tickets/:id` | Un ticket |
| POST | `/api/tickets` | Crear/upsert por UUID |
| PUT | `/api/tickets/:id` | Actualizar/upsert por UUID |
| DELETE | `/api/tickets/:id` | Registrar tombstone y eliminar |
| GET | `/api/tickets/:id/imagenes` | Metadatos de fotografías |
| POST | `/api/tickets/:id/imagenes` | Subir Blob multipart |
| GET | `/api/imagenes/:id` | Descargar fotografía |
| DELETE | `/api/imagenes/:id` | Eliminar fotografía |
| POST | `/api/sync` | Lote transaccional de tickets/eliminaciones |

Todas las consultas usan parámetros SQL. CORS admite solo los orígenes separados por coma definidos en `CORS_ORIGIN`. No hay autenticación en esta primera versión: no exponga el puerto directamente a Internet sin añadir una capa de acceso segura.

## Conflictos y eliminaciones

Los UUID se generan en el cliente y se conservan. Para un mismo UUID gana la versión con `fechaModificacion` más reciente. `tickets_eliminados` conserva la fecha de borrado; un cambio anterior al tombstone se rechaza y uno genuinamente posterior puede recrear el registro. Las fotografías usan UUID propio y `ON CONFLICT` idempotente.

## Actualizar el esquema

`sql/schema.sql` usa `IF NOT EXISTS`, por lo que puede ejecutarse nuevamente al desplegar esta versión:

```bash
psql -U evidencias_user -d evidencias_pos -f sql/schema.sql
```

Antes de cambios futuros de esquema, realice un respaldo de PostgreSQL con `pg_dump`.

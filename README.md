# Evidencias POS

PWA móvil offline-first para registrar visitas de soporte y fotografías de dispositivos. La aplicación siempre escribe primero en IndexedDB, por lo que crear, consultar, editar, cerrar, reabrir y eliminar registros no depende de la red. Opcionalmente sincroniza con una API privada en Node/Express y PostgreSQL.

## Arquitectura

```text
PWA en Android / GitHub Pages
  ├─ IndexedDB: tickets, imágenes Blob y cola durable
  ├─ Service Worker: solo archivos estáticos
  └─ HTTPS REST API
       └─ Node.js + Express en Termux
            └─ PostgreSQL local
```

No se utilizan frameworks frontend, CDN, Firebase, analítica ni servicios de almacenamiento externos. Las fotografías se reducen a un máximo de 1600 px y JPEG 0.82 antes de guardarse.

## Estructura

```text
/
├── index.html
├── css/styles.css
├── js/
│   ├── app.js       # navegación e interacción
│   ├── db.js        # IndexedDB y cola durable
│   ├── images.js    # captura y compresión
│   ├── backup.js    # exportación/restauración JSON
│   ├── ui.js
│   ├── config.js    # URL del servidor
│   ├── api.js       # cliente REST
│   └── sync.js      # sincronización bidireccional
├── backend/
│   ├── sql/schema.sql
│   ├── src/
│   ├── test/
│   └── README.md
├── manifest.json
├── service-worker.js
└── icons/icon.svg
```

## Ejecutar el frontend localmente

Los módulos ES y el Service Worker requieren HTTP. Desde la raíz:

```bash
python -m http.server 8765
```

Abra `http://localhost:8765`. Para probar el servidor, siga [backend/README.md](backend/README.md).

## IndexedDB y sincronización

La base `evidencias-soporte-db` usa la versión 2 y tres stores:

- `tickets`: metadatos, estado, dispositivos y UUID estable.
- `imagenes`: Blob JPEG separado, asociado mediante `ticketId` y `tipo`.
- `operacionesPendientes`: cambios que aún deben llegar al servidor.

Cada cambio local y su entrada de cola se escriben dentro de la misma transacción. Si no hay red, la operación permanece pendiente y se reintenta al abrir la app, recuperar conexión o pulsar **Sincronizar ahora**. El servidor resuelve actualizaciones por `fechaModificacion`; las eliminaciones usan una cola local y tombstones en PostgreSQL para impedir que una copia antigua reaparezca.

Los datos creados antes de esta versión se conservan al actualizar IndexedDB. Para migrarlos al servidor, configure la URL y pulse **Subir datos existentes** una vez. El proceso conserva UUID, es idempotente y puede repetirse sin duplicar registros ni fotografías.

La aplicación continúa funcionando completamente local si no se configura servidor.

## Configurar la conexión

En **Configuración → Servidor** indique la URL base, por ejemplo `https://pos.example.com`. Desde GitHub Pages, el navegador exige HTTPS y un certificado válido; una API HTTP o un certificado no confiable será bloqueado por seguridad. HTTP se acepta únicamente en `localhost` para desarrollo.

La pantalla muestra estado, cambios pendientes y última sincronización. Los fallos de red no bloquean el guardado local.

## PWA y Android

1. Publique el frontend bajo HTTPS.
2. Ábralo una vez en Chrome Android para cachear la aplicación.
3. Use **Instalar aplicación** o **Añadir a pantalla principal**.
4. Cierre Chrome, active modo avión y abra el icono instalado para comprobar el modo offline.

El Service Worker cachea únicamente HTML, CSS, módulos JavaScript, manifest e iconos. Nunca cachea respuestas del API. Al cambiar la lista de archivos se incrementa `CACHE_NAME`, se elimina la caché anterior y se activa la nueva versión.

## GitHub Pages

En GitHub, abra **Settings → Pages**, seleccione **Deploy from a branch**, rama `main` y carpeta `/ (root)`. La aplicación quedará normalmente en `https://rony728.github.io/evidencias-pos/`. Configure ese origen en `CORS_ORIGIN` del backend (`https://rony728.github.io`, sin la ruta).

## Respaldos

**Exportar respaldo** descarga `evidencias-pos-backup-AAAA-MM-DD.json` con versión, fecha, tickets y fotografías. IndexedDB mantiene Blob; Base64 se usa solo dentro del archivo portátil porque las APIs nativas no generan ZIP. La restauración valida la estructura y permite reemplazar o combinar, evitando UUID y nombres de gestión duplicados. Los elementos restaurados quedan pendientes de sincronización.

## Pruebas recomendadas

- Crear un registro con POS, SIM y Powerbank; recargar y confirmar persistencia.
- Crear y consultar en modo avión.
- Buscar por nombre de gestión, cliente y teléfono.
- Cerrar, reabrir y eliminar; confirmar la cascada de fotografías.
- Capturar fotografías, reiniciar la PWA y verificar los Blob.
- Detener el backend, crear cambios y confirmar el contador pendiente.
- Iniciar el backend, sincronizar y verificar tickets/imágenes en otro cliente.
- Eliminar offline, reconectar y confirmar que el tombstone evita reaparición.

Las pruebas automáticas del backend se ejecutan con `npm test` dentro de `backend/`.

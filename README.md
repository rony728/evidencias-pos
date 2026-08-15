# Evidencias Soporte

Aplicación web progresiva offline-first para registrar evidencias fotográficas de reemplazos durante visitas de soporte técnico. La **Etapa 5** incorpora instalación PWA, funcionamiento offline, respaldos y restauración local.

## Tecnologías

- HTML5, CSS3 y JavaScript Vanilla modular.
- Sin frameworks, CDN, servidores ni servicios externos.
- IndexedDB para tickets y el store reservado de imágenes.
- Blob y Canvas para comprimir fotografías localmente.
- Web App Manifest y Service Worker para uso offline.
- APIs nativas de descarga, FileReader, Storage Estimate y almacenamiento persistente.

## Estructura actual

```text
/
├── index.html
├── css/styles.css
├── js/app.js
├── js/db.js
├── js/backup.js
├── js/images.js
├── js/ui.js
├── manifest.json
├── service-worker.js
├── icons/icon.svg
└── README.md
```

## Ejecutar localmente

Sirve la carpeta con un servidor estático local, por ejemplo `python -m http.server 8765`, y abre `http://localhost:8765/`. Los módulos ES e IndexedDB requieren un contexto de navegador; no se recomienda abrir el archivo directamente con `file://`.

## Estado de esta etapa

La pantalla de inicio, nuevo registro, captura de fotografías, búsqueda, todos los registros y detalle funcionan mediante navegación SPA sin recarga completa. Los tickets se guardan en IndexedDB, sobreviven al cierre del navegador y se ordenan del más reciente al más antiguo. Las fotografías se redimensionan a una dimensión máxima aproximada de 1600 px, se convierten a JPEG con calidad 0.82 y se guardan como Blob asociados por `ticketId` y `tipo`.

La Etapa 4 agrega edición de ticket, cierre con `fechaCierre`, reapertura, eliminación en cascada de fotografías y una vista ampliada de cada fotografía usando una interfaz local.

La Etapa 5 agrega instalación como PWA, cache offline, respaldo JSON y restauración por reemplazo o combinación. El respaldo convierte las fotografías a Data URL solo dentro del archivo exportado; IndexedDB continúa utilizando Blob.

## Próximas etapas

La aplicación está funcionalmente completa. Las futuras mejoras pueden incorporar OCR, series, recorte manual, estadísticas y filtros.

## Modelo IndexedDB

La base `evidencias-soporte-db` utiliza los stores `tickets` e `imagenes`, con índices por número de ticket, estado y ticket asociado. El número de ticket se normaliza y se registra como único para evitar duplicados.

## PWA y modo offline

Al abrir la aplicación por primera vez desde HTTPS o localhost, el Service Worker cachea el HTML, CSS, JavaScript, manifest e icono. Las siguientes cargas pueden funcionar sin Internet. Para instalarla en Android, abre el sitio en Chrome y selecciona **Instalar aplicación** o **Añadir a pantalla principal**.

## Respaldos

Desde Configuración se puede exportar `evidencias-pos-backup-AAAA-MM-DD.json`. El archivo contiene versión del formato, fecha, tickets y fotografías. Al restaurar se valida su estructura y se puede reemplazar la información actual o combinarla; la combinación evita IDs y números de ticket duplicados.

# Agenda de contactos PWA

Ejercicio didáctico con **Angular 18**, componentes standalone y una API independiente
**Python + FastAPI + SQLite**. Reutiliza la aplicación de tareas: ahora permite listar,
buscar por nombre/correo/teléfono y crear, editar y eliminar contactos, incluso offline.
Usar **solo contactos ficticios**; no está preparada para datos personales reales.

La interfaz utiliza un tema oscuro propio en CSS, con acentos lavanda/cian, tarjetas
con iniciales, iconos SVG integrados y distribución adaptable a móvil. No requiere
frameworks visuales, fuentes externas ni recursos de terceros; respeta la preferencia
de movimiento reducido y mantiene estados de foco visibles para navegar con teclado.

## Requisitos y proyectos

- Node.js **22.x**, npm y Chrome/Chromium o Edge para probar la PWA.
- Python **3.11–3.14** para el backend existente; ver su propio README.
- Frontend: `Fabian/pwa/pwa-angular` (no la ubicación anterior `Fabian/pwa-angular`).
- Backend: repositorio hermano `Fabian/pwa/api`. Este proyecto no lo implementa ni modifica.

La implementación sigue [pwa.md](pwa.md). La entrega anterior se identifica con la
etiqueta Git `entrega-original-tareas` (`641c679`); los cambios de documentación que
estaban sin confirmar no forman parte de esa etiqueta. Se conserva el README de
tareas, incluida la sección de ejecución agregada por el usuario, en
[docs/README-tareas.md](docs/README-tareas.md). El [enunciado original](docs/enunciado.md),
el [README base](docs/README-base.md), los mocks y las capturas de tareas son históricos,
no evidencias de la nueva agenda.

## Instalación, build y ejecución

### 1. API (otra terminal, repositorio independiente)

Desde `../api`, siguiendo su README:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API: <http://localhost:8000>, disponibilidad: `/health`, documentación: `/docs`.
SQLite persiste por defecto en `./data/contacts.db`, relativo al directorio desde el que
se ejecuta la API. Su variable `DATABASE_PATH` permite cambiarlo. `CORS_ORIGINS`
debe permitir `http://localhost:4200` y `http://localhost:8080`, como hace por defecto.
El backend lee variables del entorno; no carga `.env` automáticamente.
No se insertan contactos de ejemplo al arrancar.

### 2. Angular

Desde este directorio:

```bash
nvm use
npm ci
npm start
```

Abrir manualmente <http://localhost:4200>. `npm start` no abre el navegador y no registra
el service worker en desarrollo.

Compilar sin iniciar un servidor:

```bash
npm run build
```

Probar producción/PWA en <http://localhost:8080>:

```bash
npm run serve:pwa
```

El script real es `ng build && http-server -p 8080 -c-1 dist/pwa-api-cache/browser`.
Para detener cada servidor, **Ctrl+C** en su terminal. `deactivate` sale del entorno Python.

### URL y timeout de la API

`src/app/api.config.ts` centraliza `API_BASE_URL` (`http://localhost:8000`) y
`API_TIMEOUT_MS` (10 segundos). No había un sistema de entornos en el proyecto;
se usa una configuración pequeña mediante tokens de Angular, sustituibles en pruebas.
Para otro backend, cambiar el valor y **recompilar**. No se repite la dirección en servicios.
Una PWA publicada por HTTPS también necesita API HTTPS para evitar contenido mixto.
En otro dispositivo, `localhost` se refiere a ese dispositivo; la demostración prevista
es local en el mismo equipo. No se añaden dependencias ni se actualiza Angular.

## Contrato HTTP

```typescript
interface Contact {
  id: string; // UUID canónico generado por Angular, también offline
  name: string;
  email: string;
  phone: string;
}
```

Nombre obligatorio después de quitar espacios exteriores; correo y teléfono opcionales,
representados por `""`, sin validación avanzada ni unicidad. La búsqueda es local.

| Método | Respuesta |
| --- | --- |
| `GET /health` | `200`, `{ "status": "ok" }` |
| `GET /api/contacts` | `200`, `{ "contacts": [...] }`; `[]` es válido |
| `GET /api/contacts/{id}` | Contacto o `404` |
| `PUT /api/contacts/{id}` | Crea (`201`) o reemplaza (`200`), devuelve el contacto |
| `DELETE /api/contacts/{id}` | `204` sin cuerpo, aunque ya no exista |

PUT envía **solo** `{ "name": "...", "email": "...", "phone": "..." }`.
Es reemplazo completo; no hay POST/PATCH. PUT con UUID de cliente y DELETE son
idempotentes: una respuesta perdida puede provocar un reenvío, pero no un alta duplicada.
No se promete ejecución exactamente una vez. Las respuestas se validan, incluidos UUID,
tipos, nombre no vacío, ids únicos en la lista e identidad del contacto reconocido por PUT.
`GET /health` y la consulta individual quedan disponibles en la API; la pantalla trabaja
con la lista y no depende de una petición de health antes de sincronizar.

## Arquitectura y persistencia

| Archivo | Responsabilidad |
| --- | --- |
| `contact.ts` | Modelo, normalización y validación de respuestas |
| `api.service.ts` | HTTP real mediante Observables y timeout, sin caché propia |
| `local-storage.service.ts` | Lectura validada y escritura del documento local |
| `contacts-store.service.ts` | Instantáneas inmutables, CRUD, cola y revisiones locales |
| `contacts-sync.service.ts` | Conectividad orientativa y un único proceso ordenado |
| `system-notifications.service.ts` | Permiso explícito y notificaciones del sistema mediante el service worker |
| `contacts/contacts.component.*` | Formulario, búsqueda, confirmaciones y estados accesibles |

Los archivos de la tabla están en `src/app/`. La clave **`pwa-contacts.state.v1`**
de `localStorage` contiene un documento:

```typescript
interface LocalState {
  version: 1;
  contacts: Contact[];
  pending: (
    | { operationId: string; type: 'put'; contact: Contact }
    | { operationId: string; type: 'delete'; contactId: string }
  )[];
  rejected?: { operationId: string; status: number | null; message: string };
}
```

Cada cambio calcula agenda y cola y las persiste en **una misma escritura** antes de
publicar éxito. Cada operación tiene UUID propio y una copia de sus datos: no se fusionan
ni compactan operaciones. Las eliminaciones sobreviven a las recargas.

Si falla la escritura por cuota o permisos, se conservan el estado anterior y el formulario,
sin enviar la edición no guardada. Si falla guardar el reconocimiento del servidor,
la operación continúa pendiente y se volverá a enviar de forma idempotente.
Si falla guardar una lista descargada, tampoco se reemplaza la agenda visible.

JSON corrupto, datos inválidos o versiones desconocidas **no se borran ni se reemplazan
automáticamente**; se bloquean edición y sincronización. La pantalla permite volver a
leer o restablecer **con confirmación de pérdida de datos locales**. Antes de restablecer,
se puede copiar el valor original desde DevTools → Application → Local Storage.
El restablecimiento afecta solo a esta clave; no borra el servidor ni otros datos del sitio.

**`localStorage` no es un respaldo.** Borrar datos del sitio elimina también los cambios
no sincronizados. Los datos pertenecen al origen y perfil del navegador: los puertos
4200 y 8080 tienen agendas/colas distintas. No usar simultáneamente ambos como editores
de la misma agenda del servidor.

## Sincronización y estados

1. Se carga y muestra primero el documento local, sin esperar a la red.
2. Se intenta sincronizar al iniciar, guardar un cambio local, recibir `online` o pulsar
   **Sincronizar/Reintentar sincronización**, siempre con la app abierta. Además, se
   comprueban los pendientes cada **5 minutos** y se intenta enviarlos si el navegador
   parece online, no hay una operación rechazada y no existe otra sincronización en curso.
3. `navigator.onLine` y los eventos son solo una orientación de **conectividad del navegador**:
   no comprueban ni la API ni el servidor frontend, y tampoco garantizan acceso a Internet.
   Si indica offline se conserva la cola; si indica online se intenta realmente el HTTP,
   que puede fallar. La PWA puede seguir abierta aunque el servidor frontend esté detenido.
4. Solo existe un proceso: envía PUT/DELETE **estrictamente en orden**. Retira cada
   operación por `operationId` solo después de éxito HTTP y de persistir su retirada,
   conservando las nuevas operaciones que lleguen durante la petición.
5. Red, timeout y `5xx` detienen la pasada conservando pendientes. No hay bucles rápidos:
   la siguiente comprobación periódica podrá reintentar, o se puede pulsar el botón sin
   esperar. Esto permite recuperarse cuando vuelve la API aunque el navegador no haya
   perdido su conexión. `408`/`429` también permiten otro intento posterior.
6. `422`, otros `4xx` no transitorios o un reconocimiento inválido bloquean esa operación;
   el bloqueo se persiste incluso tras recargar. **Corregir operación rechazada** sustituye
   explícitamente un PUT por otro con nuevo `operationId`, en el mismo lugar de la cola
   y con el mismo UUID de contacto. No pisa ediciones/bajas posteriores. Una edición normal
   solo agrega otro pendiente: no corrige automáticamente el que bloquea. También se puede
   **Reintentar operación explícitamente**, por ejemplo después de reparar el servidor.
   No hay descarte automático; un DELETE rechazado permite el reintento explícito.
7. Solo sin pendientes se descarga la lista completa. Antes de aplicarla se comprueban cola
   vacía y revisión local sin cambios. Si el GET envejeció, se descarta su respuesta y se
   procesan los nuevos pendientes antes de volver a consultar. PUT nunca pisa la agenda
   con su respuesta, que podría ser anterior a una edición local.

La UI separa guardado en dispositivo, pendientes, sincronización en curso, sincronizado
y error. Muestra contador y última sincronización completa, y distingue validación local,
almacenamiento, red, rechazo del servidor y respuesta inválida. Una agenda local vacía
no significa que la API haya sido consultada: comprobar el estado de sincronización.
La búsqueda sin resultados tiene un mensaje diferente. Un error nunca se sustituye
silenciosamente por contactos de ejemplo ni borra la agenda visible.

El guardado local correcto se confirma en verde con **«Cambios locales guardados»**;
no significa que la API ya los haya recibido. Los fallos de conexión, timeout o disponibilidad
(`502`/`503`/`504`) muestran un aviso de cambios sin sincronizar, sin un error técnico rojo.
Si no quedan pendientes, el aviso indica que no se pudo actualizar la agenda desde la API,
en lugar de afirmar que hay cambios por enviar. Los errores de validación, almacenamiento
y otros errores reales del servidor siguen mostrándose como errores.

Si la pasada envió cambios, confirmó su retirada local de la cola y completó la descarga
final, aparece el aviso verde **«Cambios sincronizados con la API»**, con botón para cerrarlo.
No aparece si la pasada falla ni por una consulta sin cambios pendientes; se limpia ante
nuevos cambios para no confundirse con una confirmación de esas ediciones. Es un aviso
**dentro de la app**, que no requiere permisos. Opcionalmente también puede mostrarse
una notificación del sistema si el usuario lo autoriza, como se describe más abajo.

El intervalo se define en `AUTO_SYNC_INTERVAL_MS` de `contacts-sync.service.ts` y se inicia
al crear el servicio; recargar reinicia el temporizador (además del intento inicial inmediato).
No realiza consultas periódicas si la cola está vacía, está bloqueada o el navegador indica
offline. Los navegadores pueden retrasar los temporizadores de pestañas en segundo plano
o suspendidas: los cinco minutos no son una garantía de ejecución exacta. No funciona
con la app cerrada. El temporizador se ejecuta fuera de la zona de Angular para no retrasar
la estabilidad inicial ni el registro del service worker, y se cancela al destruir el servicio.

### Notificaciones del sistema (opcionales, con la app abierta)

1. Usar la compilación PWA (`npm run serve:pwa`) en `http://localhost:8080`, o HTTPS
   al publicar. En `npm start` el worker está desactivado: se mantienen los avisos internos
   y la pantalla indica cómo probar la versión PWA.
2. Pulsar **Activar notificaciones**. Solo ese clic llama a `Notification.requestPermission()`;
   no se pide permiso automáticamente al abrir ni desde el temporizador.
3. Si se concede, cada pasada que envíe cambios y termine su reconciliación muestra
   **Agenda de contactos — Cambios sincronizados con la API**, con el icono de contactos.
   No se notifica por un GET aislado, un guardado únicamente local o una pasada fallida.
4. Si se bloquea, se informa en pantalla y no se insiste. Cambiar el permiso desde los
   ajustes del sitio y volver a la app o pulsar **Actualizar permisos**. Si se cierra la
   solicitud sin decidir, se puede volver a pulsar el botón de activación.

Se utiliza `ServiceWorkerRegistration.showNotification()` del worker Angular existente,
sin modificar el backend, añadir servicios externos, suscripciones push ni permisos en
el manifiesto. El mensaje es genérico: no muestra nombres, correos ni teléfonos.
Una etiqueta fija permite reemplazar avisos anteriores en vez de acumularlos.

El aviso dentro de la app **siempre se conserva** como respaldo. Un navegador no compatible,
HTTP no seguro, permiso denegado, worker no listo o fallo al mostrar la notificación no
afectan a contactos, cola ni sincronización. La espera del worker está limitada a 5 segundos,
fuera de la zona de Angular; si no está listo, se informa y el siguiente éxito podrá intentar
notificar de nuevo. Las preferencias de notificaciones del sistema operativo (por ejemplo,
No molestar) pueden impedir un banner aunque el navegador tenga permiso.

Chrome/Chromium o Edge de escritorio son el entorno de demostración previsto. En móviles
la disponibilidad depende del navegador, sistema y, en algunos casos, instalación de la PWA;
no se promete compatibilidad universal. La app no sincroniza cerrada ni recibe mensajes push,
aunque una notificación ya mostrada pueda seguir en el centro de notificaciones del sistema.

## PWA: interfaz y datos son cosas distintas

- **Service worker / Cache Storage:** `ngsw-config.json` conserva HTML, JS, CSS, manifiesto
  e iconos con `prefetch`, para abrir la interfaz offline. Se eliminó `tasks-api` y no se
  añadió un `dataGroup` de contactos. El backend usa `Cache-Control: no-store`.
- **`localStorage`:** conserva contactos y cola; no depende del caché HTTP ni del service worker.
- Se mantienen rutas hash y registro del worker solo en producción. Los iconos de
  instalación y el favicon reutilizan el símbolo de contactos de la cabecera, en lavanda
  sobre fondo oscuro. Los PNG incluyen tamaños adaptables (`maskable`) y Apple Touch.
  La fuente está en `public/assets/icons/contact.svg`; para regenerarlos se puede ejecutar
  `python3 scripts/generate-icons.py` con `rsvg-convert` (librsvg) instalado. Los PNG ya
  están incluidos: no hace falta esa herramienta para instalar, compilar o usar la app.
- Hace falta una **primera carga online completa** y esperar a que el service worker
  quede activo y controle la página. Recargar online una vez antes de probar offline.
  Tener contactos locales no basta si el navegador nunca guardó la interfaz.
- Una instalación antigua puede seguir mostrando la versión de tareas hasta que se active
  la actualización; cerrar todas sus ventanas y volver a abrir online. No borrar los datos
  del sitio como actualización rutinaria: eso eliminaría pendientes de la agenda.

No hay autenticación, conflictos entre dispositivos, múltiples pestañas editoras,
Background Sync, notificaciones push, IndexedDB ni garantía de sincronización con la app cerrada.
Alcance: **un usuario, un dispositivo y una sola pestaña editora activa**; última escritura
recibida gana. No exponer esta API sin protección con información privada.

## Pruebas

```bash
npm test -- --watch=false --browsers=ChromeHeadless
```

Con Chromium en Linux, si Karma no lo encuentra:

```bash
CHROME_BIN=/usr/bin/chromium npm test -- --watch=false --browsers=ChromeHeadless
```

Las pruebas Jasmine/Karma usan `HttpTestingController` y `MemoryStorage`, nunca la API
ni los datos reales del navegador. Cubren almacenamiento, validación, orden, idempotencia
del reintento en el cliente, exclusión de procesos, ediciones durante PUT/GET, bloqueos
persistentes, reintentos periódicos con reloj simulado y avisos en componentes. Los permisos
y las notificaciones del sistema se simulan con `FakeNotificationsBrowser`: las pruebas
unitarias no muestran solicitudes ni notificaciones reales.
El contrato del servidor tiene sus pruebas en el otro proyecto.

Guía de aceptación manual: [docs/pruebas-contactos.md](docs/pruebas-contactos.md).
Resultados ejecutados: [docs/verificacion-contactos.md](docs/verificacion-contactos.md).

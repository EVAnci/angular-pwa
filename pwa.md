# Plan de transformación: PWA de tareas a contactos

## Contexto y objetivo

Este proyecto es un ejercicio de clase construido con Angular 18. Actualmente muestra una lista de tareas de Mockachino y demuestra instalación como PWA, caché de recursos y consulta sin conexión.

Transformarlo, **reutilizando la aplicación existente**, en una agenda de contactos con CRUD local y sincronización con una API Python. El objetivo didáctico de la ampliación es trabajar sin conexión y enviar los cambios al recuperar la conectividad, no solo consultar respuestas guardadas.

La aplicación Angular se trasladó a `Fabian/pwa/pwa-angular`. Confirmar la ruta absoluta antes de trabajar: la ubicación anterior `Fabian/pwa-angular` ya no existe. El backend estará en otro repositorio; no implementarlo ni modificarlo desde este proyecto.

## Antes de modificar

1. Leer las instrucciones del repositorio y revisar el código real, su estado de Git y los scripts disponibles.
2. Conservar el trabajo del usuario. No resetear ni sobrescribir cambios ajenos.
3. Proponer conservar una versión identificable de la entrega original mediante una etiqueta o rama; no crear commits, ramas ni etiquetas sin autorización.
4. Revisar el contrato real de la API y su documento `back.md`, si está disponible. El contrato resumido aquí es el acordado, no una confirmación de que el backend ya lo implementó.

## Alcance acordado

- Agenda pequeña, un usuario y un dispositivo.
- Consultar, buscar, crear, editar y eliminar contactos.
- Persistir contactos y operaciones pendientes con `localStorage`.
- Seguir trabajando sin conexión, incluso después de recargar la aplicación si ya se guardó su interfaz.
- Sincronizar con la API al iniciar, al recuperar conexión y mediante un botón, **mientras la app esté abierta**.
- Mantener la infraestructura Angular y PWA existente.
- Usar contactos ficticios: no es una aplicación preparada para datos personales reales.

No implementar autenticación, conflictos entre dispositivos, ejecución garantizada con la app cerrada, Background Sync, notificaciones push, fotos ni una arquitectura compleja. IndexedDB puede ser una evolución posterior, pero no es necesario para este alcance.

## Contrato esperado del backend

API FastAPI + SQLite; URL local prevista: `http://localhost:8000`.

```typescript
interface Contact {
  id: string; // UUID generado por Angular, también al crear sin conexión
  name: string;
  email: string;
  phone: string;
}
```

- `name`: obligatorio, no vacío después de quitar espacios exteriores.
- `email` y `phone`: opcionales en el formulario, representados como `""` si no se completan.
- Sin validación avanzada ni unicidad por nombre, correo o teléfono.

| Método y ruta | Resultado esperado |
| --- | --- |
| `GET /health` | `200`, `{ "status": "ok" }` |
| `GET /api/contacts` | `200`, `{ "contacts": [...] }`; lista vacía válida |
| `GET /api/contacts/{id}` | Contacto o `404` |
| `PUT /api/contacts/{id}` | Crea (`201`) o reemplaza (`200`); devuelve el contacto completo |
| `DELETE /api/contacts/{id}` | `204`, incluso si ya no existe |

El cuerpo de PUT contiene `name`, `email` y `phone`, no `id`. PUT es reemplazo completo, no actualización parcial. No se necesita POST: PUT con UUID del cliente permite reintentar altas sin duplicarlas. DELETE también es idempotente.

La API debe permitir CORS desde `http://localhost:4200` y `http://localhost:8080`. Para publicar una PWA con HTTPS, la API también debe estar disponible por HTTPS.

## Cambios funcionales

### Pantalla y modelo

- Reemplazar el modelo de tarea, el servicio, sus validaciones y los textos por contactos.
- Retirar filtros Todas/Pendientes/Completadas y el campo `completed`.
- Mostrar nombre, correo y teléfono; permitir búsqueda local por esos campos.
- Añadir formulario de alta y edición, con etiquetas accesibles y validación mínima del nombre.
- Añadir eliminación con confirmación.
- Diferenciar agenda vacía de búsqueda sin resultados.
- No insertar datos de ejemplo como sustituto silencioso de una API fallida.

### Estados visibles

- Indicador de conexión orientativo basado en `navigator.onLine` y eventos online/offline. No asumir que estar online implica que la API funciona.
- Estado de sincronización: guardado en el dispositivo, operaciones pendientes, sincronizando, sincronizado o error.
- Contador de pendientes y botón para reintentar la sincronización.
- Separar errores de almacenamiento local, validación, red y servidor.
- Una operación guardada solo localmente no debe presentarse como confirmada por el servidor.
- Mostrar errores sin descartar la agenda ni las modificaciones locales.

## Almacenamiento local

Implementar un servicio dedicado que guarde un documento JSON versionado en una clave propia de `localStorage`, con una estructura equivalente a:

```typescript
interface LocalState {
  version: 1;
  contacts: Contact[];
  pending: PendingOperation[];
}

type PendingOperation =
  | { operationId: string; type: 'put'; contact: Contact }
  | { operationId: string; type: 'delete'; contactId: string };
```

- Cada operación debe tener identificador propio y un payload inmutable: no guardar referencias que cambien con futuras ediciones.
- Al crear/editar/eliminar, calcular y persistir juntos la agenda resultante y la cola en **una misma escritura**, antes de anunciar éxito en la interfaz.
- Si la escritura falla, por ejemplo por cuota, no afirmar que el cambio quedó guardado ni continuar enviándolo como si estuviera persistido.
- Validar el contenido leído y manejar JSON corrupto o versiones desconocidas sin borrarlos silenciosamente; ofrecer un error y una recuperación explícita.
- Persistir también las eliminaciones pendientes para que sobrevivan a una recarga.
- Evitar compactar o fusionar operaciones en la primera versión: una cola ordenada es más sencilla de verificar.
- Aclarar que borrar los datos del sitio elimina también los cambios no sincronizados. `localStorage` no es un respaldo.

## Algoritmo de sincronización

1. Cargar primero el estado local y mostrarlo sin depender de la red.
2. Disparar sincronización al iniciar, ante un evento online o por acción manual. Si está offline, conservar pendientes; si parece online, intentar la petición.
3. Permitir **un solo proceso de sincronización a la vez**. Evitar que varios disparadores envíen operaciones en paralelo.
4. Procesar la cola estrictamente en orden: PUT para altas/ediciones y DELETE para bajas.
5. Mantener cada operación hasta recibir éxito HTTP y persistir su retirada de la cola. Retirarla por su `operationId`, sin perder operaciones nuevas añadidas mientras había una petición en curso.
6. Ante fallo de red o `5xx`, conservar la operación y detener esta pasada. Reintentar al próximo disparador; no usar bucles rápidos e infinitos. Aplicar un timeout razonable a las peticiones para no bloquear indefinidamente la cola.
7. Ante `422` u otro error no transitorio, mostrar el problema y conservar el cambio. No reintentar indefinidamente ni descartar la operación automáticamente; permitir corregirla mediante una acción explícita.
8. Solo cuando los pendientes estén confirmados, consultar `GET /api/contacts` para reconciliar el estado con el servidor.
9. Antes de aplicar la respuesta de GET, comprobar que no hubo cambios locales desde que comenzó la consulta y que la cola sigue vacía. Si hubo cambios, no sobrescribirlos con una respuesta vieja; procesar los pendientes y reconciliar después.
10. Validar respuestas antes de usarlas. Un fallo al descargar o validar la lista nunca debe borrar la agenda local.

Puede usarse un contador de revisiones locales para proteger la reconciliación, además de la comprobación de cola vacía. Los reconocimientos de PUT tampoco deben sobrescribir ediciones posteriores del mismo contacto.

Si el servidor aplicó una operación pero su respuesta se perdió, se volverá a enviar: el UUID y los métodos idempotentes impiden duplicados. No prometer semántica de ejecución exactamente una vez.

El alcance admite una sola pestaña activa para editar; documentarlo. Si se desea soportar varias pestañas concurrentes será necesario coordinar escrituras y sincronización, fuera de esta primera versión.

## Service worker y PWA

El proyecto existente dispone de:

- `public/manifest.webmanifest`: identidad e instalación.
- `src/index.html`: enlace al manifiesto.
- `ngsw-config.json`: caché de interfaz y antiguo grupo de datos `tasks-api`.
- Registro del service worker Angular en la configuración de la aplicación.

Acciones:

- Conservar el caché de HTML, JavaScript, CSS, manifiesto e iconos para abrir offline.
- Eliminar el `dataGroup` de Mockachino y sus referencias obsoletas.
- No añadir la API de contactos a un `dataGroup` en esta primera versión: la agenda offline la administra el servicio local, y la sincronización debe consultar la red sin recibir una lista vieja del service worker.
- Cambiar nombre, descripción, título y textos a una agenda de contactos. Revisar si los iconos existentes siguen siendo adecuados sin generar recursos nuevos innecesariamente.
- Mantener el desarrollo sin service worker y probar las capacidades PWA con compilación de producción.
- Explicar que hace falta una primera carga online para guardar la interfaz; una agenda local no basta si el navegador nunca almacenó la aplicación.

## Configuración y ejecución

- Hacer configurable la URL base del backend usando el patrón existente del proyecto. Evitar repetir direcciones en varios servicios.
- Revisar los scripts reales antes de documentarlos. Los scripts conocidos eran:
  - `npm ci`: dependencias.
  - `npm start`: desarrollo en `http://localhost:4200`.
  - `npm run build`: compilación.
  - `npm run serve:pwa`: compilación y servidor estático en `http://localhost:8080`.
- La última versión conocida de `serve:pwa` ejecutaba `ng build && http-server -p 8080 -c-1 dist/pwa-api-cache/browser`; verificar que siga vigente.
- Detener servidores con `Ctrl+C` en su terminal. No afirmar que `npm start` abre automáticamente el navegador salvo que esté configurado.
- Para simular caída solo de la API, detener el backend. Para probar desconexión de la página, usar DevTools → Network → Offline.
- No instalar dependencias innecesarias ni aplicar actualizaciones mayores o correcciones automáticas de auditoría fuera del alcance.

## Etapas sugeridas

1. Adaptar modelo, UI y servicio HTTP; verificar CRUD conectado contra el backend real.
2. Introducir estado persistente local y cola; todas las ediciones pasan por el mismo flujo local incluso con conexión.
3. Implementar sincronización ordenada, protección contra respuestas antiguas y estados visibles.
4. Ajustar manifiesto, service worker, documentación y pruebas offline.

## Pruebas y criterios de aceptación

- Se pueden listar, buscar, crear, editar y eliminar contactos conectados.
- Un UUID generado offline se conserva después de sincronizar; no se crean duplicados al reintentar.
- Se pueden hacer varias ediciones offline, recargar y conservar agenda y pendientes.
- Al volver la API, los pendientes se envían en orden y la lista final coincide con el servidor.
- Crear → editar → eliminar offline termina sin ese contacto en el servidor.
- Una respuesta perdida se puede reintentar de forma segura.
- Un error de red o `5xx` conserva pendientes y datos visibles.
- Un `422` se informa sin descartar la operación ni entrar en un bucle.
- Una edición realizada durante un PUT o GET en curso no se pierde.
- Disparadores simultáneos no crean dos sincronizaciones concurrentes.
- JSON local corrupto o falta de espacio se informa sin pérdida silenciosa.
- Una agenda vacía válida no se confunde con un fallo de API.
- La PWA instalada abre y permite trabajar offline después de su primera carga completa.
- Reiniciar el backend conserva sus contactos; recargar Angular conserva su cola.
- Las pruebas automatizadas usan HTTP simulado y almacenamiento aislado, no la API ni datos reales.

Priorizar pruebas unitarias del almacenamiento y de la sincronización, además de las de componentes que correspondan al proyecto. Añadir una guía de prueba manual con backend detenido, desconexión del navegador y reconexión.

## Documentación a actualizar

- README: nuevo objetivo, arquitectura cliente/API, contrato, requisitos y ejecución de ambos proyectos.
- Reemplazar las decisiones sobre tareas y Mockachino por las del modelo de contactos.
- Documentar que ahora sí se usa `localStorage`, qué contiene, sus límites y el riesgo de borrar pendientes.
- Distinguir caché del service worker (interfaz) de almacenamiento local (contactos y cola).
- Documentar sincronización solo con app abierta, un usuario/dispositivo y una pestaña editora; no prometer resolución de conflictos.
- Actualizar pruebas y evidencias cuando se hayan realizado realmente; no inventar capturas ni resultados.

Mantener la solución pequeña, legible y didáctica. Si el contrato real del backend difiere o una decisión amplía el alcance, consultar antes de implementarla.

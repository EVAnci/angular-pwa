# Guía manual de aceptación: contactos

Usar exclusivamente datos ficticios, una pestaña editora y un perfil/origen de pruebas.
Estas instrucciones son una guía; no implican que todos los pasos ya se hayan ejecutado.
Los resultados reales se anotan en [verificacion-contactos.md](verificacion-contactos.md).

## Preparación y CRUD conectado

1. Iniciar el backend según su README y Angular con `npm run serve:pwa`.
2. Abrir `http://localhost:8080/#/`. Comprobar disponibilidad de `/health` y estado
   **Sincronizado con la API**. Una lista vacía válida no debe aparecer como error.
3. Crear «Ana Ficticia», correo `ana@example.com` y teléfono `123`. Revisar en Network
   que PUT envíe solo `name`, `email`, `phone` y que el UUID vaya en la URL.
4. Editar el nombre, guardar y comprobar PUT y luego GET; buscar por cada campo.
   Probar una búsqueda inexistente y diferenciarla de agenda vacía.
5. Cancelar una eliminación: el contacto debe seguir. Confirmarla: DELETE debe responder
   `204` y la lista final debe coincidir con `GET /api/contacts`.
6. Probar nombre vacío o solo espacios: error del formulario, sin operación ni petición.
   Correo/teléfono vacíos son válidos. No hay validación de formato avanzada.

## Caída de la API sin desconectar el navegador

1. Dejar el navegador online y detener **solo el backend** con Ctrl+C.
2. Crear un contacto y editarlo varias veces. Comprobar la confirmación verde **Cambios
   locales guardados**, el aviso **Cambios locales sin sincronizar** y el contador de
   pendientes; los datos siguen visibles y no se presentan como confirmados por la API.
3. Inspeccionar Application → Local Storage → `pwa-contacts.state.v1`: cada edición es
   un PUT independiente, con distinto `operationId`, y conserva su payload anterior.
4. Recargar: agenda y pendientes permanecen. No debe aparecer una lista de ejemplo.
5. Reiniciar el backend y, sin pulsar botones ni guardar cambios nuevos, esperar la
   siguiente comprobación de 5 minutos con la app abierta. Aunque detener el backend no
   cambia `navigator.onLine`, el temporizador debe volver a intentar los pendientes.
   También puede comprobarse el botón **Reintentar sincronización** sin esperar al intervalo.
6. Comprobar envío en orden, sin peticiones de escritura paralelas, seguido de GET.
   El UUID inicial no cambia y no hay duplicados. La cola termina vacía.
7. Reiniciar el backend de nuevo: sus contactos deben seguir en SQLite.

## Reintento periódico y aviso al usuario

1. Confirmar que el indicador aclara que es la conexión aparente **del navegador**,
   no una comprobación de disponibilidad del frontend o del backend.
2. Con API detenida, guardar un cambio y esperar una comprobación periódica. Debe
   conservar agenda y pendientes, sin mostrar un aviso de éxito de sincronización.
3. Arrancar la API y mantener la app abierta. En la siguiente comprobación debe
   completar la cola y mostrar en verde **Cambios sincronizados con la API**. Pulsar
   **Cerrar** en el aviso y comprobar que desaparece. El aviso interno no requiere permisos;
   la notificación del sistema es opcional y se activa como se explica a continuación.
4. Con cola vacía no deben aparecer peticiones de API por el temporizador ni avisos de
   cambios sincronizados por una simple descarga manual.
5. Un nuevo cambio local debe retirar la notificación anterior; su confirmación local
   sigue siendo **Cambios locales guardados**, independiente de la confirmación de la API.
6. Una operación bloqueada por `422` no debe reenviarse al cumplirse el intervalo:
   continúa requiriendo corrección o reintento explícitos.

El intervalo empieza al abrir la app y reinicia al recargar. No es un temporizador
de fondo garantizado: el navegador puede retrasarlo al minimizar, suspender la pestaña
o bloquear el dispositivo. Las pruebas unitarias verifican los 5 minutos con reloj simulado,
sin tener que esperar en tiempo real ni usar la API real.

## Permiso y notificación del sistema

1. Usar un perfil/origen de pruebas con `npm run serve:pwa`, en `http://localhost:8080`.
   Esperar a que el worker esté activo. No debe aparecer ninguna solicitud de permiso al
   abrir la app, consultar contactos ni guardar cambios sin haber pulsado el botón.
2. Pulsar **Activar notificaciones** y permitirlas en el diálogo del navegador. La pantalla
   debe indicar **Permiso concedido**. El permiso por sí solo no genera una notificación.
3. Crear o editar un contacto y esperar a la confirmación de sincronización. Debe aparecer
   la notificación del sistema con el icono de contactos y sin datos del contacto. El aviso
   verde dentro de la app debe mantenerse también.
4. Detener la API, guardar un cambio y confirmar que no se notifica éxito. Iniciarla y
   esperar el reintento de 5 minutos (o pulsar Sincronizar): al completarse debe notificar.
5. Sin pendientes, pulsar Sincronizar: una descarga por sí sola no debe generar otra
   notificación del sistema.
6. Desde los permisos del sitio, bloquear las notificaciones y volver a la app. Debe
   indicar **Notificaciones bloqueadas** sin insistir con nuevos diálogos. Guardar y
   sincronizar sigue funcionando y el aviso verde interno sigue disponible.
7. Probar cerrar el diálogo sin aceptar o denegar: debe poder repetirse la activación.
   Probar también `npm start`: debe explicar que las notificaciones se prueban en la PWA.
8. Si hay permiso pero no se ve un banner, revisar No molestar y los permisos del navegador
   en el sistema operativo. En móviles comprobar compatibilidad e instalación cuando corresponda.

No se necesita modificar el manifest ni el backend. No se prueban push ni sincronización
con la app cerrada. Cambiar permisos no requiere borrar los datos del sitio ni sus pendientes.

Para comprobar el sistema sin crear o editar contactos, conceder el permiso y pulsar
**Probar notificación**. Debe mostrar el título **Prueba de notificación**, conservar
agenda y cola, y no generar peticiones a la API. Si el sistema rechaza el envío, la pantalla
debe informar el fallo y no afirmar que la prueba se envió. El botón no aparece sin permiso.

## Desconexión de la página y recarga PWA

1. Con producción online, esperar en DevTools → Application → Service Workers a que
   `ngsw-worker.js` esté activo. Recargar online y confirmar que controla la página.
2. En Cache Storage comprobar los grupos de archivos `app` y `assets`; no debe existir
   un nuevo grupo de API de contactos. Una instalación antigua podría conservar cachés
   históricos hasta que se active la nueva versión y Angular los limpie.
3. En Manifest comprobar nombre **Agenda de contactos**, iconos, scope e inicio. Instalar
   desde el navegador y abrir la ventana instalada; no usarla a la vez que otra pestaña editora.
4. En DevTools → Network seleccionar **Offline**. Crear, editar y eliminar contactos.
5. Crear uno, editarlo y eliminarlo antes de reconectar. Anotar su UUID a partir de su PUT
   local pendiente; sus operaciones deben quedar PUT → PUT → DELETE.
6. Recargar normalmente, sin borrar datos ni hacer hard reload: deben abrir la interfaz
   y la agenda local con sus pendientes, incluso si se detuvo el servidor estático.
7. Desactivar Offline. La app debe sincronizar, vaciar la cola y consultar la lista final.
   El contacto de la secuencia crear/editar/eliminar no debe existir en el servidor.
8. Cerrar la app estando offline no promete sincronización en segundo plano; reabrir
   online inicia otra pasada. La primera apertura absoluta sin interfaz cacheada no funciona offline.

## Errores y recuperación (solo perfil de pruebas)

- **422 / 4xx no transitorio:** simularlo con un interceptor de pruebas o un servidor de
  prueba, sin modificar el backend de trabajo. No enviar más operaciones ni hacer GET
  después del rechazo. Recargar no debe reintentar el bloqueo. Usar **Corregir operación
  rechazada** (PUT) o el reintento explícito tras reparar la causa. Las ediciones/bajas
  posteriores deben conservarse; no se descarta ningún pendiente silenciosamente.
- **500/red/timeout:** conservar agenda y operación; detener la pasada, no hacer un bucle.
- **JSON corrupto / versión desconocida:** copiar primero la clave a un archivo externo;
  sustituir su contenido por `{roto` o cambiar `version` a `2`, y recargar. Debe informar
  error sin cambiar ese contenido ni consultar la API. Cancelar el restablecimiento no debe
  borrar nada; confirmar debe reemplazar solo esta clave y permitir descargar la lista.
- **Cuota/permisos:** se cubre de forma reproducible con almacenamiento aislado en las
  pruebas unitarias. No llenar deliberadamente el almacenamiento real. El formulario no
  debe cerrarse ni anunciar un guardado al fallar la escritura; tampoco se envía ese cambio.
- **Concurrencia/respuestas perdidas:** las pruebas con HTTP simulado permiten retrasar
  PUT/GET y comprobar que otra edición o un disparador online no causa pérdida ni procesos
  simultáneos. Reenviar una operación confirmada en el servidor conserva UUID y no duplica.

**Borrar datos del sitio borra los pendientes.** No usar Clear site data como solución
habitual ante errores o actualizaciones. Los puertos 4200 y 8080 no comparten localStorage.

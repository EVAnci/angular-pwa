# Verificación de la agenda

## Ejecutado

- Compilación de producción con `npm run build`: correcta; se generó `ngsw.json`.
- `CHROME_BIN=/usr/bin/chromium npm test -- --watch=false --browsers=ChromeHeadless`:
  **95 pruebas correctas** en Chromium 156, con Node 22.23.4 (incluye permisos y notificaciones simulados).
- Las pruebas usan HTTP simulado y almacenamiento en memoria: no modifican la API,
  SQLite ni el almacenamiento real del usuario.
- Comprobación de navegador sobre la compilación de producción, en Chromium headless
  mediante Chrome DevTools Protocol, con perfil temporal y API HTTP simulada en memoria:
  - Service worker de Angular activo y controlando la página.
  - Alta/edición offline y secuencia alta → edición → eliminación: cinco operaciones
    guardadas y conservadas después de recargar completamente con Network Offline.
  - Reconexión: las cinco operaciones llegaron en orden, se conservó el UUID del contacto
    superviviente y el eliminado no reapareció; cola vacía y sincronización completada.
  - API simulada en `503` con navegador online: datos y pendiente conservados al recargar;
    recuperación al pulsar reintento manual.
  - JSON corrupto conservado sin cambios y recuperación solo tras confirmar el restablecimiento.
  - Sin excepciones JavaScript no gestionadas durante el recorrido.
- Consultas de solo lectura al backend existente: `/health` respondió `200` con
  `{"status":"ok"}` y `/openapi.json` confirmó las rutas esperadas. El código de
  `../api/app/main.py` coincide con `back.md`; no se modificó el backend ni su SQLite.

La comprobación de navegador usó un servidor estático separado en `localhost:18080`
e interceptó las peticiones de API de página y service worker hacia el simulador.
No se hicieron escrituras en la API del usuario ni se tocaron sus servidores 8000/8080.

La herramienta de compilación emite un aviso de antigüedad de `baseline-browser-mapping`;
no impide compilar y no se actualizaron dependencias fuera del alcance.

### Rediseño oscuro

- Nueva compilación de producción correcta y las **51 pruebas** siguen pasando.
- Recorrido offline repetido con el nuevo diseño: recarga, sincronización, errores
  y recuperación conservan su funcionamiento.
- Revisión visual en Chromium de escritorio y móvil, con contactos ficticios aislados.
- Lista y formulario sin desbordamiento horizontal a 320, 390, 768 y 1280 píxeles.
- `color-scheme: dark` aplicado y animación de sincronización desactivada al emular
  `prefers-reduced-motion: reduce`.
- Metadatos del navegador y del manifiesto PWA ajustados al fondo oscuro. Sin nuevas
  dependencias ni fuentes externas.

### Iconos de contactos

- Sustituida la marca de tareas por el mismo trazado de agenda de la cabecera, con
  fondo oscuro lavanda. Actualizados favicon, iconos del manifiesto y Apple Touch.
- Verificados tamaños PNG, fondo totalmente opaco y símbolo dentro del círculo seguro
  central del 80 % en las variantes `maskable` de 192 y 512 píxeles.
- Compilación de producción correcta después de reemplazar los recursos.
- La actualización del icono de una app ya instalada depende del navegador y del sistema;
  no se ha comprobado su propagación en instalaciones existentes. Si fuera necesario
  reinstalar, sincronizar primero los pendientes y no elegir borrar los datos del sitio.

### Avisos de guardado y sincronización

- Suite ampliada a **59 pruebas correctas** y compilación de producción correcta.
- Confirmación verde «Cambios locales guardados» para crear, editar y eliminar,
  sin confundirla con una confirmación del servidor.
- Red, timeout y `502`/`503`/`504` muestran un aviso de sincronización pendiente;
  si la cola está vacía, el mensaje indica que no se pudo actualizar la agenda.
- Probado que un fallo de escritura no muestra confirmación verde y que los errores
  `500` y `422` siguen visibles como errores, conservando los datos y la corrección explícita.

### Reintento automático cada 5 minutos

- Suite ampliada a **74 pruebas correctas**, con HTTP simulado y reloj de `fakeAsync`.
- Compilación de producción correcta con el temporizador y el aviso de sincronización.
- Verificado que solo se reintenta con pendientes, sin bloqueo, con conectividad aparente
  y sin otra pasada activa; sin consultas periódicas con cola vacía ni bucles rápidos.
- Fallos repetidos conservan la cola y no generan avisos de éxito. `422` continúa bloqueado.
- Un aviso verde se emite solo después de confirmar escrituras, persistir reconocimientos
  y completar la reconciliación; no por un GET aislado ni si falla el almacenamiento o GET.
- Probados cierre del aviso, limpieza ante nuevos cambios, edición durante GET y cancelación
  del temporizador al destruir el servicio. El componente muestra el aviso sin permisos push.
- La temporización se verificó con reloj simulado, no con una espera real de cinco minutos
  contra la API Python del usuario.

### Notificaciones del sistema con permiso

- Suite ampliada a **95 pruebas correctas** y compilación de producción correcta.
- Pruebas unitarias con un adaptador aislado: concesión, rechazo, cierre del diálogo,
  solicitudes duplicadas, revocación, falta de soporte, HTTP inseguro y modo desarrollo.
- Probados fallos al solicitar/mostrar y timeout del worker: no afectan a la sincronización
  ni al aviso interno. El reintento periódico confirmado también llama al notificador.
- Recorrido en Chromium headless con perfil temporal, API simulada y worker Angular real:
  sin solicitudes automáticas de permiso; permiso concedido solo al origen de pruebas
  mediante CDP; tras la sincronización se verificó con `getNotifications()` la notificación
  nativa registrada, su título, cuerpo e icono. Sin notificación de éxito ante API simulada
  en `503`. Recarga offline y distribución móvil/escritorio siguen funcionando.
- Esa comprobación no interactuó con el diálogo real de permisos ni verificó visualmente
  un banner del sistema operativo; ambos siguen en la guía manual. No se probó en móviles reales.

## Pendiente de comprobación manual

- Instalación desde la interfaz del navegador y reapertura de la ventana instalada.
- Diálogo real de permisos y banner del sistema operativo, según navegador y sistema.
- CRUD real contra la API Python y comprobación de persistencia al reiniciarla
  (la prueba de navegador usó un simulador, no SQLite).
- Recorrido completo de [pruebas-contactos.md](pruebas-contactos.md) con el entorno del usuario.

Las capturas en `docs/evidencias/` pertenecen a la entrega anterior de tareas, conservada
en la etiqueta `entrega-original-tareas`. No se presentan como evidencias de contactos
ni se incorporaron capturas nuevas al repositorio.

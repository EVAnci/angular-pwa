# PWA de consulta con Angular

> Documento histórico de la entrega de tareas. No describe la aplicación actual.
> Se conserva también la sección BUILD and RUN agregada antes de la transformación.
> La guía vigente está en [../README.md](../README.md).

Aplicación web progresiva pequeña que consume una API de Mockachino. Basada en el repositorio de la cátedra [pwa-angular](https://github.com/fabiancontigliani/pwa-angular); el README original quedó en [README-base.md](README-base.md) y el enunciado en [enunciado.md](enunciado.md).

## Decisiones de diseño

### 1. Alternativa elegida y alcance

**Lista de tareas.** La aplicación permite:

- Ver las tareas que devuelve la API.
- Filtrarlas en el navegador: **Todas**, **Pendientes** o **Completadas**.
- Pulsar **Actualizar** para volver a consultar la API.

Es una aplicación **solo de consulta**: no crea, edita ni marca tareas. Para cambiar los datos se edita la respuesta configurada en Mockachino.

Las pantallas de ejemplo del repositorio base (usuarios, tabla de usuarios, personas y contactos) se eliminan, y la lista de tareas pasa a ser la pantalla inicial.

### 2. Campos de cada elemento

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | número | Sí | Identificador único de la tarea |
| `title` | texto | Sí | Descripción de la tarea, no vacía |
| `completed` | booleano | Sí | `true` si la tarea está terminada |

Los tres campos son obligatorios. Si la respuesta no tiene la forma del punto 3, o algún elemento no tiene estos campos con su tipo, la aplicación lo muestra como **error de formato**: no lo convierte en una lista vacía ni descarta elementos sin avisar.

### 3. Endpoint y estructura JSON

```text
GET https://www.mockachino.com/13417dd4-d40d-4e/tasks
```

- Estado `200` y `Content-Type: application/json`.
- CORS habilitado (`Access-Control-Allow-Origin: *`), así que el navegador puede leer la respuesta desde `localhost`.
- El cuerpo es **un objeto con la propiedad `tasks`**, que contiene la lista de tareas:

```json
{
  "tasks": [
    { "id": 1, "title": "Revisar el repositorio base", "completed": true },
    { "id": 2, "title": "Crear el endpoint en Mockachino", "completed": true },
    { "id": 3, "title": "Conectar la API", "completed": false }
  ]
}
```

No se usa una lista directa porque Mockachino solo acepta un objeto JSON como cuerpo de respuesta: al intentar guardar una lista responde `422` con `"value is not a valid dict"`. El servicio espera exactamente esta forma: lee `tasks` y, si falta o no es una lista, informa un error de formato.

La respuesta completa cargada en Mockachino está en [mock/tasks.json](mock/tasks.json). La misma URL se usaba en el servicio Angular y en `dataGroups` de `ngsw-config.json`.

Para editar los datos del mock: <https://www.mockachino.com/spaces/13417dd4-d40d-4e>. Mockachino no tiene cuentas: este enlace se deduce de la URL de lectura, así que cualquiera que la conozca puede editar el mock.

### 4. Información disponible sin conexión

- **La interfaz completa:** HTML, JavaScript, CSS, manifest e iconos, guardados por el service worker al instalarse.
- **La última lista de tareas obtenida mientras el service worker controlaba la página**, durante un máximo de 7 días.
- **El filtro**, porque se aplica en el navegador sobre la lista ya cargada.

Sin conexión, el botón Actualizar sigue haciendo la petición y el service worker responde con la copia guardada.

### 5. Sin datos, falla de la API y primera carga

| Situación | Qué muestra la aplicación |
| --- | --- |
| Petición en curso | Indicador de carga; el botón Actualizar queda deshabilitado |
| La API devuelve una lista vacía | "No hay tareas." |
| El filtro no deja ninguna tarea | "No hay tareas pendientes." o "No hay tareas completadas." |
| La API falla y no había tareas en pantalla | Mensaje de error y botón **Reintentar** |
| La API falla y ya había tareas en pantalla | Se conservan las tareas y se muestra el error |
| Sin conexión y sin datos guardados (el service worker responde `504`) | "Se necesita conexión para la primera carga de datos." |
| La respuesta no cumple el formato del punto 2 | Error de formato |

Además:

- Un **aviso de sin conexión** aparece según `navigator.onLine` y los eventos `online`/`offline`. Es solo orientativo: no impide la petición, porque el service worker puede responder desde su caché.
- Tras una consulta exitosa se muestra **"Datos obtenidos a las HH:MM"** y no "actualizados del servidor", porque la aplicación no puede saber si la respuesta vino de la red o del caché.
- Nunca se muestran datos de ejemplo escritos en el código en lugar de la respuesta de la API.

### 6. Cambios locales

**No hay cambios locales.** La aplicación no usa `localStorage` ni IndexedDB.

Lo único que se guarda en el navegador es el caché del service worker (Cache Storage). Para restablecerlo: DevTools → **Application** → **Storage** → **Clear site data**. Después hay que volver a abrir la aplicación con conexión para que guarde de nuevo la interfaz y los datos.

## Requisitos

- Node.js **22.x** y npm. Versiones usadas: Node **22.23.4** y npm **10.9.9**.
- Chrome o Edge de escritorio para instalar la aplicación y probarla sin conexión.

Con [nvm](https://github.com/nvm-sh/nvm), el archivo `.nvmrc` selecciona la versión de Node:

```bash
nvm use
```

## Instalación y ejecución local

```bash
npm ci
```

Desarrollo (sin service worker):

```bash
npm start
```

Compilación de producción servida como PWA en `http://localhost:8080`:

```bash
npm run serve:pwa
```

> El `package-lock.json` del repositorio base no coincidía con su `package.json` y `npm ci` fallaba. Se regeneró con `npm install` sin cambiar las versiones de Angular (18.2.14).

## Caché del service worker

El service worker de Angular (`ngsw-worker.js`) se configura en `ngsw-config.json` con dos tipos de grupos.

### assetGroups

Guardan los archivos necesarios para **abrir la aplicación**:

- `app`: `index.html`, JavaScript, CSS y manifest. Se descargan al instalar el service worker (`prefetch`).
- `assets`: iconos y demás recursos de `public/assets/`. Se cambia de `lazy` a `prefetch` para que estén disponibles desde la primera instalación.

### dataGroups y estrategia elegida

Guardan **respuestas de la API**. Hay un solo grupo, `tasks-api`, para el endpoint de tareas:

| Opción | Valor | Significado |
| --- | --- | --- |
| `strategy` | `freshness` | Primero intenta la red; si falla, usa la copia guardada |
| `timeout` | `5s` | Si la red tarda más de 5 segundos, usa la copia guardada |
| `maxAge` | `7d` | Una copia con más de 7 días deja de usarse |
| `maxSize` | `10` | Máximo de respuestas guardadas (no de tareas dentro de la lista) |

Se elige `freshness` porque prioriza mostrar los datos más recientes cuando hay conexión y recurre al caché solo cuando la red no responde.

## Instalación de la PWA y prueba sin conexión

Usar Chrome o Edge de escritorio, con la compilación de producción (`npm run serve:pwa`) abierta en `http://localhost:8080`. En modo desarrollo (`npm start`) el service worker no se registra.

### 1. Primera carga con conexión

1. Abrir `http://localhost:8080` y comprobar que aparecen las tareas.
2. Abrir DevTools → **Application** → **Service Workers** y esperar a que `ngsw-worker.js` figure como *activated and is running*. Mantener desactivado **Bypass for network**.
3. **Recargar la página.** La primera consulta ocurre antes de que el service worker controle la página, así que esa respuesta no queda guardada.
4. En **Cache Storage** comprobar que existen las entradas `ngsw:/:<hash>:assets:app:cache` (interfaz) y `ngsw:/:1:data:tasks-api:cache` (respuesta de la API).

### 2. Manifest e instalación

1. En **Application** → **Manifest** comprobar el nombre "Lista de tareas", el nombre corto "Tareas", los iconos y la URL de inicio, sin errores.
2. Instalar desde el icono de instalación de la barra de direcciones (o menú ⋮ → **Instalar Lista de tareas**).
3. Abrir la app instalada y comprobar que se abre en una ventana propia, con el nombre y el icono del tilde.

### 3. Recarga sin conexión

1. En DevTools → **Network** activar **Offline**.
2. Recargar normalmente, sin borrar datos ni anular el service worker.
3. Comprobar que se muestran la interfaz, el aviso de sin conexión y las tareas guardadas.
4. Probar los filtros y pulsar **Actualizar**: las tareas siguen apareciendo porque el service worker responde con la copia guardada.
5. Desactivar **Offline** y pulsar **Actualizar** para volver a obtener los datos de la red.

### 4. Primera carga de datos sin conexión

Para ver el mensaje "Se necesita conexión para la primera carga de datos.":

1. En **Application** → **Storage**, pulsar **Clear site data**.
2. Abrir `http://localhost:8080` con conexión **una sola vez, sin recargar**, y esperar a que el service worker figure como activo. La interfaz queda guardada y la respuesta de la API no.
3. Activar **Offline** y recargar.

Después de esta prueba, repetir el paso 1 para volver a guardar los datos.

### Reiniciar desde cero

En **Application** → **Storage**, **Clear site data** borra el service worker y todos los cachés. Después hay que volver a hacer la primera carga con conexión.

## Limitaciones

- **Hace falta una primera carga con conexión.** Si la aplicación nunca se abrió con conexión, no se puede abrir sin conexión. Si se guardó la interfaz pero no la respuesta de la API, se muestra el aviso de primera carga.
- **Los datos tienen que cargarse con el service worker ya activo.** La primera consulta puede ocurrir antes de que el service worker controle la página; en ese caso hay que recargar o pulsar Actualizar.
- **El service worker tiene que terminar de guardar la interfaz.** Si se pierde la conexión mientras todavía descarga los archivos, queda en modo degradado y no puede abrir la aplicación sin conexión hasta que vuelva a tener red.
- **El caché vence a los 7 días** y se pierde si se borran los datos del sitio o el navegador libera espacio.
- **La aplicación no distingue entre datos de la red y datos del caché.**

## Evidencias

Capturas tomadas en Chromium sobre la compilación de producción (`npm run serve:pwa`).

### Lista cargada con el service worker activo

La lista coincide con el JSON del mock y `ngsw-worker.js` figura como *activated and is running* y controla `http://localhost:8080/#/`.

![Lista cargada](evidencias/1-lista.png)

### Instalación

Chromium ofrece instalar la aplicación con el nombre "Lista de tareas" y el icono del manifest.

![Diálogo de instalación](evidencias/2-instalar.png)

Una vez instalada, la aplicación se abre en una ventana propia, sin barra de direcciones ni pestañas, con el título "Lista de tareas" y el icono del tilde.

![Aplicación instalada](evidencias/2-instalada.png)

### Recarga sin conexión

Con **Offline** activo en DevTools y después de recargar, se muestran la interfaz, el aviso de sin conexión y las tareas. En Network todo sale del service worker (0 B transferidos). La consulta a `tasks` falla en la red y el service worker responde con la copia guardada, como indica la estrategia `freshness`.

![Recarga sin conexión](evidencias/3-offline.png)

## BUILD and RUN

### Build

Para construir la aplicación, ejecuta el siguiente comando:

```bash
npm run build
```

Este comando compila la aplicación y genera los archivos necesarios en el directorio `dist/`.

### Run

Para ejecutar la aplicación en modo de desarrollo, usa:

```bash
npm start
```

Esto iniciará el servidor de desarrollo en `http://localhost:4200`. Abrir esa dirección manualmente; el script no abre el navegador automáticamente.

Para ejecutar la aplicación en modo PWA, usa:

```bash
npm run serve:pwa
```

Esto compilará la aplicación y la servirá en `http://localhost:8080`.

### Stop

Para detener la aplicación, simplemente presiona `Ctrl + C` en la terminal donde se está ejecutando el servidor. Esto detendrá el servidor y liberará el puerto.

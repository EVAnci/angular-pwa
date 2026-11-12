# Agent Development Rules - PWA Angular de contactos

Este documento define las reglas, convenciones y patrones de desarrollo para este proyecto PWA Angular.

La aplicación vigente es la agenda descrita en `pwa.md` y `README.md`. El service worker
cachea solo la interfaz; los contactos y la cola se guardan juntos en localStorage.
`ContactsStoreService` publica estado inmutable y `ContactsSyncService` envía una sola
cola ordenada. La URL base se centraliza en `src/app/api.config.ts`. No modificar el backend.

## 📋 Información del Proyecto

- **Framework**: Angular 18+
- **Lenguaje**: TypeScript 5.4+
- **Arquitectura**: PWA (Progressive Web App) con Service Worker
- **Estrategia de Routing**: Hash Location (`/#/route`)
- **Patrón de Componentes**: Standalone Components
- **Estado**: RxJS Observables con async pipe

## 🏗️ Arquitectura del Proyecto

### Estructura de Directorios

```
src/
├── app/
│   ├── [feature]/              # Carpetas por feature
│   │   ├── *.component.ts      # Componente TypeScript
│   │   └── *.component.html    # Template HTML
│   ├── *.service.ts            # Servicios globales
│   ├── app.config.ts           # Configuración de la app
│   ├── app.routes.ts           # Definición de rutas
│   ├── app.component.*         # Componente raíz
│   └── main.ts                 # Entry point
├── index.html                  # HTML principal
└── styles.css                  # Estilos globales
public/
├── assets/                     # Assets estáticos
│   └── icons/                  # Iconos PWA
└── manifest.webmanifest        # PWA manifest
```

## 🎯 Reglas de TypeScript

### Configuración Estricta

```json
{
  "strict": true,
  "noImplicitOverride": true,
  "noPropertyAccessFromIndexSignature": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true
}
```

### Reglas de Código

1. **Strict Mode**: Siempre habilitado
2. **Target**: ES2022
3. **Module Resolution**: bundler
4. **Experimental Decorators**: Habilitado para Angular
5. **Source Maps**: Habilitado en desarrollo

## 🧩 Componentes

### Reglas de Componentes

1. **SIEMPRE usar Standalone Components**
   ```typescript
   @Component({
     selector: 'app-feature',
     standalone: true,
     imports: [CommonModule],
     templateUrl: './feature.component.html',
   })
   ```

2. **Nomenclatura de Selectores**
   - Prefijo: `app-`
   - Formato: kebab-case
   - Ejemplo: `app-users`, `app-contacts`

3. **Imports Requeridos**
   - `CommonModule` para usar `*ngFor`, `*ngIf`, `async` pipe
   - Importar solo lo necesario

4. **Manejo de Estado**
   - Usar Observables de RxJS
   - Sufijo `$` para variables Observable
   - Usar `async` pipe en templates
   - Inicializar con `EMPTY` cuando sea carga manual

### Patrones de Componentes

#### Carga Manual (con botón)
```typescript
export class FeatureComponent {
  data$!: Observable<any[]>;

  constructor(private service: ApiService) {
    this.data$ = EMPTY; // Inicializa vacío
  }

  loadData() {
    this.data$ = this.service.getData();
  }
}
```

#### Carga Automática (OnInit)
```typescript
export class FeatureComponent implements OnInit {
  data$!: Observable<any[]>;

  constructor(private service: ApiService) {}

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.data$ = this.service.getData();
  }
}
```

## 🔌 Servicios

### Reglas de Servicios

1. **Injectable Root**
   ```typescript
   @Injectable({
     providedIn: 'root'
   })
   ```

2. **Retornar Observables**
   - Nunca Promises
   - Tipar como `Observable<T[]>` o `Observable<T>`

3. **Manejo de Respuestas de API**
   - Usar `pipe` y `map` para transformar datos
   - Validar la forma de la respuesta contra el contrato documentado en el README
 ### Patrón de Servicio API

```typescript
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly contactsUrl = 'API_URL/api/contacts';

  constructor(private readonly http: HttpClient) { }

  getContacts(): Observable<Contact[]> {
    return this.http.get<unknown>(this.contactsUrl).pipe(map(parseContacts));
  }
}

// parseContacts valida { "contacts": [...] } y lanza InvalidResponseError si no coincide.
// Ejemplo abreviado: en la implementación real la URL se inyecta y hay timeout.
```

## 🎨 Templates HTML

### Reglas de Templates

1. **Uso de Directivas**
   - `*ngFor` para listas
   - `*ngIf` para condicionales
   - `async` pipe para Observables

2. **Sintaxis de Binding**
   - Event binding: `(click)="method()"`
   - Property binding: `[property]="value"`
   - Interpolation: `{{ variable }}`

3. **Estructura Semántica**
   ```html
   <h2>Título Descriptivo (Tipo de Caché)</h2>
   <button (click)="loadData()">Acción</button>
   <ul>
     <li *ngFor="let item of items$ | async">
       {{ item.property }}
     </li>
   </ul>
   ```

## 🛣️ Routing

### Configuración de Rutas

1. **Hash Location Strategy**
   ```typescript
   provideRouter(routes, withHashLocation())
   ```
   - URL de la pantalla inicial: `/#/`
   - Necesario para servir con http-server

2. **Definición de Rutas**
   ```typescript
   export const routes: Routes = [
     { path: 'feature', component: FeatureComponent },
     { path: '', redirectTo: 'default', pathMatch: 'full' }
   ];
   ```

3. **Navegación**
   ```html
   <a routerLink="/feature">Link</a>
   ```

## 🔧 Service Worker & PWA

### Configuración de Caché (ngsw-config.json)

#### Asset Groups
- **app**: prefetch (archivos core)
- **assets**: lazy load (imágenes, fuentes)

#### Data Groups - Estrategias

La agenda actual **no usa dataGroups**: su almacenamiento offline y sincronización son
explícitos. Las estrategias de abajo son referencia general, no la configuración activa.

1. **Sin Caché** (no configurar en ngsw-config.json)
   - Siempre desde red
   - Para datos que cambian frecuentemente

2. **Freshness Strategy** (network-first)
   ```json
   {
     "strategy": "freshness",
     "timeout": "5s",
     "maxAge": "1d",
     "maxSize": 10
   }
   ```
   - Prioriza red
   - Fallback a caché si red falla/timeout
   - Para datos semi-dinámicos

3. **Performance Strategy** (cache-first)
   ```json
   {
     "strategy": "performance",
     "maxAge": "2m",
     "maxSize": 10
   }
   ```
   - Prioriza caché
   - Actualiza en background
   - Para datos estables

### Service Worker Config

```typescript
provideServiceWorker('ngsw-worker.js', {
  enabled: !isDevMode(),
  registrationStrategy: 'registerWhenStable:30000'
})
```

- Solo habilitado en producción
- Espera 30s de estabilidad antes de registrar

## 📦 Build & Deployment

### Scripts NPM

```json
{
  "start": "ng serve",              // Dev server (http://localhost:4200)
  "build": "ng build",              // Production build
  "serve:pwa": "ng build && http-server -p 8080 -c-1 dist/pwa-api-cache/browser"
}
```

### Budgets de Build

- **Initial Bundle**: 500kB warning, 1MB error
- **Component Styles**: 2kB warning, 4kB error

### Output Path

- Producción: `dist/pwa-api-cache/browser/`

## 📝 Configuración del Proyecto

### App Config (app.config.ts)

```typescript
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
```

### Providers Requeridos

1. `provideRouter` con `withHashLocation()`
2. `provideHttpClient()` para llamadas HTTP
3. `provideServiceWorker()` para PWA

## 🎨 Estilos

### Convenciones CSS

1. **Estilos Globales**: `src/styles.css`
2. **Estilos por Componente**: `*.component.css`
3. **Sin preprocesadores**: CSS puro

### Estructura de Estilos

```css
/* Elementos principales */
h1, h2 { color: #333; }

/* Componentes interactivos */
button {
  padding: 10px 20px;
  background-color: #3f51b5;
  color: white;
}

/* Listas */
ul { list-style-type: none; padding: 0; }
li { padding: 8px; background-color: white; }
```

## 🔍 Testing

### Configuración

- Framework: Jasmine + Karma
- Tipos: `@types/jasmine`
- Cobertura: karma-coverage

## 📋 Convenciones de Código

### Nomenclatura

1. **Archivos**
   - Componentes: `feature.component.ts`
   - Servicios: `feature.service.ts`
   - Formato: kebab-case

2. **Clases**
   - PascalCase: `FeatureComponent`, `ApiService`

3. **Variables**
   - camelCase: `userData`, `isLoading`
   - Observables: sufijo `$` → `users$`, `contacts$`

4. **Métodos**
   - camelCase: `loadData()`, `getUsers()`
   - Verbos descriptivos

### Comentarios

```typescript
// Comentarios en español
// Explicar el "por qué", no el "qué"

// 1. Proveedor de HttpClient para hacer llamadas API
provideHttpClient(),
```

## 🚫 Reglas de .gitignore

### Excluir del Repositorio

- `/dist`, `/node_modules`, `/.angular/cache`
- Archivos de configuración del IDE (excepto configuraciones compartidas)
- Logs: `npm-debug.log`, `yarn-error.log`
- Archivos del sistema: `.DS_Store`, `Thumbs.db`

## 🔐 Seguridad y Buenas Prácticas

1. **No hardcodear credenciales**: Usar variables de entorno
2. **Validar inputs**: Especialmente en formularios
3. **Sanitizar HTML**: Angular lo hace por defecto
4. **CORS**: Configurar correctamente en backend
5. **HTTPS**: Obligatorio para Service Workers en producción

## 🐛 Debugging

### Herramientas

1. **Angular DevTools**: Para inspeccionar componentes
2. **Service Worker**: Chrome DevTools → Application → Service Workers
3. **Network Tab**: Verificar estrategias de caché

### Comandos Útiles

```bash
# Limpiar caché de Angular
rm -rf .angular/cache

# Verificar Service Worker
# Chrome: chrome://serviceworker-internals/

# Build con análisis
ng build --stats-json
```

## 📚 Referencias

- [Angular Docs](https://angular.dev)
- [Angular PWA](https://angular.dev/ecosystem/service-workers)
- [RxJS](https://rxjs.dev)
- [TypeScript](https://www.typescriptlang.org)

---

**Última actualización**: 2025-10-30
**Versión del Proyecto**: 0.0.0
**Angular**: 18.0.0

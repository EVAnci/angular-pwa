import { DestroyRef, Injectable, InjectionToken, NgZone, inject, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, EMPTY, TimeoutError, concatMap, defer, finalize, from, fromEvent, merge, timeout } from 'rxjs';

type NotificationRegistration = Pick<ServiceWorkerRegistration, 'showNotification'>;

export interface NotificationsBrowser {
  readonly supported: boolean;
  readonly secureContext: boolean;
  readonly workerEnabled: boolean;
  getPermission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  ready(): Promise<NotificationRegistration>;
}

export const NOTIFICATIONS_BROWSER = new InjectionToken<NotificationsBrowser>('NOTIFICATIONS_BROWSER', {
  providedIn: 'root',
  factory: () => ({
    supported: typeof Notification !== 'undefined' && 'serviceWorker' in navigator
      && typeof ServiceWorkerRegistration !== 'undefined'
      && 'showNotification' in ServiceWorkerRegistration.prototype,
    secureContext: window.isSecureContext,
    workerEnabled: !isDevMode(),
    getPermission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    ready: () => navigator.serviceWorker.ready,
  }),
});

export interface SystemNotificationState {
  readonly availability: 'available' | 'unsupported' | 'insecure' | 'development';
  readonly permission: NotificationPermission;
  readonly requesting: boolean;
  readonly notice: string | null;
}

const WORKER_READY_TIMEOUT_MS = 5000;

@Injectable({ providedIn: 'root' })
export class SystemNotificationsService {
  private readonly browser = inject(NOTIFICATIONS_BROWSER);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly stateSubject = new BehaviorSubject<SystemNotificationState>({
    availability: 'unsupported', permission: 'default', requesting: false, notice: null,
  });
  readonly state$ = this.stateSubject.asObservable();

  constructor() {
    this.refreshPermission();
    // Reflejar permisos cambiados en los ajustes del sitio sin volver a pedirlos.
    merge(fromEvent(window, 'focus'), fromEvent(document, 'visibilitychange'))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshPermission());
  }

  get snapshot(): SystemNotificationState { return this.stateSubject.value; }

  refreshPermission(): void {
    const availability = !this.browser.secureContext ? 'insecure'
      : !this.browser.supported ? 'unsupported'
      : !this.browser.workerEnabled ? 'development' : 'available';
    try {
      const permission = this.browser.supported ? this.browser.getPermission() : 'default';
      this.publish({
        availability, permission,
        ...(permission !== this.snapshot.permission ? { notice: null } : {}),
      });
    } catch {
      this.publish({ availability: 'unsupported', notice: 'No se pudieron consultar los permisos. Se mantienen los avisos dentro de la app.' });
    }
  }

  enable(): void {
    this.refreshPermission();
    if (this.snapshot.availability !== 'available' || this.snapshot.permission !== 'default'
      || this.snapshot.requesting) return;
    this.publish({ requesting: true, notice: null });
    // Se invoca directamente desde el clic, antes de cualquier espera asíncrona.
    let request: Promise<NotificationPermission>;
    try {
      request = this.browser.requestPermission();
    } catch {
      this.permissionFailed();
      this.publish({ requesting: false });
      return;
    }
    from(request).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.publish({ requesting: false })),
    ).subscribe({
      next: permission => this.publish({
        permission,
        notice: permission === 'default' ? 'No se activaron las notificaciones. Puedes volver a intentarlo con el botón.' : null,
      }),
      error: () => this.permissionFailed(),
    });
  }

  notifySynced(): void {
    this.refreshPermission();
    if (this.snapshot.availability !== 'available' || this.snapshot.permission !== 'granted') return;
    // La espera del worker no debe bloquear ni la sincronización ni la estabilidad inicial de Angular.
    this.zone.runOutsideAngular(() => {
      defer(() => from(this.browser.ready())).pipe(
        timeout(WORKER_READY_TIMEOUT_MS),
        concatMap(registration => {
          this.refreshPermission();
          if (this.snapshot.permission !== 'granted') return EMPTY;
          return from(registration.showNotification('Agenda de contactos', {
            body: 'Cambios sincronizados con la API.',
            icon: new URL('assets/icons/contact-192x192.png', document.baseURI).href,
            tag: 'contacts-sync',
            lang: 'es',
          }));
        }),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: () => this.publish({ notice: null }),
        error: error => {
          this.refreshPermission();
          this.publish({ notice: error instanceof TimeoutError
            ? 'Las notificaciones del sistema aún no están listas. El aviso se conserva dentro de la app.'
            : 'No se pudo mostrar la notificación del sistema. Se conserva el aviso dentro de la app; revisa los permisos del navegador y del sistema.' });
        },
      });
    });
  }

  private permissionFailed(): void {
    this.refreshPermission();
    this.publish({ notice: 'No se pudo solicitar el permiso. Se mantienen los avisos dentro de la app; revisa los permisos del sitio.' });
  }

  private publish(change: Partial<SystemNotificationState>): void {
    this.zone.run(() => this.stateSubject.next({ ...this.snapshot, ...change }));
  }
}

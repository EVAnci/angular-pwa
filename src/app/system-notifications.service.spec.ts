import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { NOTIFICATIONS_BROWSER, SystemNotificationsService } from './system-notifications.service';
import { FakeNotificationsBrowser } from './testing/fake-notifications-browser';

describe('SystemNotificationsService', () => {
  let browser: FakeNotificationsBrowser;
  let service: SystemNotificationsService;

  beforeEach(() => {
    browser = new FakeNotificationsBrowser();
    TestBed.configureTestingModule({ providers: [{ provide: NOTIFICATIONS_BROWSER, useValue: browser }] });
    service = TestBed.inject(SystemNotificationsService);
  });

  it('no solicita permisos al cargar la app ni al sincronizar sin permiso', () => {
    service.notifySynced();
    expect(service.snapshot.permission).toBe('default');
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(browser.ready).not.toHaveBeenCalled();
    expect(browser.registration.showNotification).not.toHaveBeenCalled();
  });

  it('pide permiso directamente al activar y evita solicitudes duplicadas', fakeAsync(() => {
    let resolve!: (permission: NotificationPermission) => void;
    browser.requestPermission.and.returnValue(new Promise<NotificationPermission>(done => resolve = done));
    service.enable();
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(service.snapshot.requesting).toBeTrue();
    service.enable();
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    browser.permission = 'granted';
    resolve('granted');
    flushMicrotasks();
    expect(service.snapshot.permission).toBe('granted');
    expect(service.snapshot.requesting).toBeFalse();
    expect(browser.registration.showNotification).not.toHaveBeenCalled();
  }));

  it('muestra la notificación con permiso, el nuevo icono y sin datos personales', fakeAsync(() => {
    browser.permission = 'granted';
    service.notifySynced();
    flushMicrotasks();
    expect(browser.registration.showNotification).toHaveBeenCalledOnceWith('Agenda de contactos', {
      body: 'Cambios sincronizados con la API.',
      icon: new URL('assets/icons/contact-192x192.png', document.baseURI).href,
      tag: 'contacts-sync',
      lang: 'es',
    });
    expect(service.snapshot.notice).toBeNull();
    expect(browser.requestPermission).not.toHaveBeenCalled();
  }));

  it('no vuelve a pedir permiso cuando ya está concedido o bloqueado', () => {
    for (const permission of ['granted', 'denied'] as const) {
      browser.permission = permission;
      service.enable();
      expect(service.snapshot.permission).toBe(permission);
    }
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });

  it('conserva el rechazo y no muestra una notificación del sistema', fakeAsync(() => {
    browser.nextPermission = 'denied';
    service.enable();
    flushMicrotasks();
    service.notifySynced();
    expect(service.snapshot.permission).toBe('denied');
    expect(service.snapshot.requesting).toBeFalse();
    expect(browser.ready).not.toHaveBeenCalled();
  }));

  it('permite volver a activar si el usuario cierra la solicitud sin decidir', fakeAsync(() => {
    browser.nextPermission = 'default';
    service.enable();
    flushMicrotasks();
    expect(service.snapshot.permission).toBe('default');
    expect(service.snapshot.notice).toContain('Puedes volver a intentarlo');
    browser.nextPermission = 'granted';
    service.enable();
    flushMicrotasks();
    expect(service.snapshot.permission).toBe('granted');
    expect(browser.requestPermission).toHaveBeenCalledTimes(2);
  }));

  it('no solicita ni muestra notificaciones sin soporte, contexto seguro o worker de producción', () => {
    browser.supported = false;
    service.enable();
    service.notifySynced();
    expect(service.snapshot.availability).toBe('unsupported');
    browser.supported = true;
    browser.secureContext = false;
    service.enable();
    service.notifySynced();
    expect(service.snapshot.availability).toBe('insecure');
    browser.secureContext = true;
    browser.workerEnabled = false;
    service.enable();
    service.notifySynced();
    expect(service.snapshot.availability).toBe('development');
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(browser.ready).not.toHaveBeenCalled();
  });

  it('maneja una excepción síncrona al solicitar permiso sin bloquear la app', () => {
    browser.requestPermission.and.throwError('NotAllowedError');
    expect(() => service.enable()).not.toThrow();
    expect(service.snapshot.requesting).toBeFalse();
    expect(service.snapshot.notice).toContain('No se pudo solicitar el permiso');
  });

  it('maneja un rechazo asíncrono al solicitar permiso', fakeAsync(() => {
    browser.requestPermission.and.callFake(() => Promise.reject(new Error('Blocked')));
    service.enable();
    flushMicrotasks();
    expect(service.snapshot.requesting).toBeFalse();
    expect(service.snapshot.notice).toContain('Se mantienen los avisos dentro de la app');
  }));

  it('informa un fallo del sistema de notificaciones sin propagarlo', fakeAsync(() => {
    browser.permission = 'granted';
    browser.registration.showNotification.and.callFake(() => Promise.reject(new Error('OS unavailable')));
    expect(() => service.notifySynced()).not.toThrow();
    flushMicrotasks();
    expect(service.snapshot.notice).toContain('No se pudo mostrar la notificación del sistema');
  }));

  it('limita la espera del worker y no muestra un aviso tardío tras el timeout', fakeAsync(() => {
    let ready!: (registration: typeof browser.registration) => void;
    browser.permission = 'granted';
    browser.ready.and.returnValue(new Promise(done => ready = done));
    service.notifySynced();
    tick(5000);
    expect(service.snapshot.notice).toContain('aún no están listas');
    ready(browser.registration);
    flushMicrotasks();
    expect(browser.registration.showNotification).not.toHaveBeenCalled();
  }));

  it('comprueba otra vez el permiso antes de mostrar si se revocó mientras esperaba', fakeAsync(() => {
    let ready!: (registration: typeof browser.registration) => void;
    browser.permission = 'granted';
    browser.ready.and.returnValue(new Promise(done => ready = done));
    service.notifySynced();
    browser.permission = 'denied';
    ready(browser.registration);
    flushMicrotasks();
    expect(browser.registration.showNotification).not.toHaveBeenCalled();
    expect(service.snapshot.permission).toBe('denied');
  }));

  it('refleja permisos cambiados desde los ajustes cuando se vuelve a la ventana', () => {
    browser.permission = 'denied';
    window.dispatchEvent(new Event('focus'));
    expect(service.snapshot.permission).toBe('denied');
    browser.permission = 'granted';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(service.snapshot.permission).toBe('granted');
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });

  it('cancela la espera al destruir el servicio', fakeAsync(() => {
    let ready!: (registration: typeof browser.registration) => void;
    browser.permission = 'granted';
    browser.ready.and.returnValue(new Promise(done => ready = done));
    service.notifySynced();
    TestBed.resetTestingModule();
    ready(browser.registration);
    flushMicrotasks();
    expect(browser.registration.showNotification).not.toHaveBeenCalled();
  }));

  it('maneja que el navegador impida incluso consultar los permisos', () => {
    spyOn(browser, 'getPermission').and.throwError('SecurityError');
    expect(() => service.refreshPermission()).not.toThrow();
    expect(service.snapshot.availability).toBe('unsupported');
    expect(service.snapshot.notice).toContain('No se pudieron consultar los permisos');
  });
});

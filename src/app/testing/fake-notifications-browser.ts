import { NotificationsBrowser } from '../system-notifications.service';

// Evita acceder a permisos reales o abrir notificaciones del sistema durante las pruebas.
export class FakeNotificationsBrowser implements NotificationsBrowser {
  supported = true;
  secureContext = true;
  workerEnabled = true;
  permission: NotificationPermission = 'default';
  nextPermission: NotificationPermission = 'granted';
  readonly registration = {
    showNotification: jasmine.createSpy('showNotification').and.callFake(() => Promise.resolve()),
  };
  readonly requestPermission = jasmine.createSpy('requestPermission').and.callFake(() => {
    this.permission = this.nextPermission;
    return Promise.resolve(this.permission);
  });
  readonly ready = jasmine.createSpy('ready').and.callFake(() => Promise.resolve(this.registration));

  getPermission(): NotificationPermission { return this.permission; }
}

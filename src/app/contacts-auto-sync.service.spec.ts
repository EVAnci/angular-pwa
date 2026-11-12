import { TestBed, discardPeriodicTasks, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE_URL } from './api.config';
import { ContactsStoreService } from './contacts-store.service';
import { AUTO_SYNC_INTERVAL_MS, ContactsSyncService } from './contacts-sync.service';
import { LOCAL_STORAGE } from './local-storage.service';
import { CONTACT, MemoryStorage } from './testing/memory-storage';
import { NOTIFICATIONS_BROWSER, SystemNotificationsService } from './system-notifications.service';
import { FakeNotificationsBrowser } from './testing/fake-notifications-browser';

describe('Reintento automático de contactos', () => {
  let memory: MemoryStorage;
  let store: ContactsStoreService;
  let sync: ContactsSyncService;
  let http: HttpTestingController;
  let online: boolean;
  let notifications: (string | null)[];
  const url = 'http://test.invalid/api/contacts';

  beforeEach(() => {
    memory = new MemoryStorage();
    online = true;
    notifications = [];
    spyOnProperty(navigator, 'onLine', 'get').and.callFake(() => online);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: API_BASE_URL, useValue: 'http://test.invalid' },
      { provide: LOCAL_STORAGE, useValue: memory },
      { provide: NOTIFICATIONS_BROWSER, useFactory: () => new FakeNotificationsBrowser() },
    ] });
  });

  // Se crea el servicio dentro de fakeAsync: el reloj simulado controla sus intervalos.
  function start(): void {
    store = TestBed.inject(ContactsStoreService);
    sync = TestBed.inject(ContactsSyncService);
    http = TestBed.inject(HttpTestingController);
    sync.notification$.subscribe(value => notifications.push(value));
  }

  function createAndFail(): string {
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({}, { status: 503, statusText: 'Unavailable' });
    return id;
  }

  afterEach(() => http.verify());

  it('no consulta periódicamente la API si no hay operaciones pendientes', fakeAsync(() => {
    start();
    tick(AUTO_SYNC_INTERVAL_MS * 3);
    http.expectNone(() => true);
    expect(notifications.filter(Boolean)).toEqual([]);
    discardPeriodicTasks();
  }));

  it('reintenta a los cinco minutos y notifica solo después de confirmar y reconciliar', fakeAsync(() => {
    start();
    const id = createAndFail();
    const before = store.snapshot;
    tick(AUTO_SYNC_INTERVAL_MS - 1);
    http.expectNone(() => true);
    tick(1);
    const request = http.expectOne(`${url}/${id}`);
    expect(request.request.method).toBe('PUT');
    expect(store.snapshot).toBe(before);
    request.flush({ ...CONTACT, id });
    expect(store.snapshot!.pending).toEqual([]);
    expect(notifications.filter(Boolean)).toEqual([]);
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id }] });
    expect(notifications.filter(Boolean)).toEqual(['Cambios sincronizados con la API.']);
    tick(AUTO_SYNC_INTERVAL_MS * 2);
    http.expectNone(() => true);
    expect(notifications.filter(Boolean).length).toBe(1);
    discardPeriodicTasks();
  }));

  it('si falla otra vez, conserva la cola y espera otros cinco minutos sin notificar éxito', fakeAsync(() => {
    start();
    const id = createAndFail();
    const before = store.snapshot;
    for (const status of [503, 504]) {
      tick(AUTO_SYNC_INTERVAL_MS);
      http.expectOne(`${url}/${id}`).flush({}, { status, statusText: 'Unavailable' });
      expect(store.snapshot).toBe(before);
      expect(notifications.filter(Boolean)).toEqual([]);
      http.expectNone(() => true);
    }
    discardPeriodicTasks();
  }));

  it('no envía peticiones periódicas mientras el navegador indica offline', fakeAsync(() => {
    start();
    online = false;
    window.dispatchEvent(new Event('offline'));
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    tick(AUTO_SYNC_INTERVAL_MS * 2);
    http.expectNone(() => true);
    expect(store.snapshot!.pending.length).toBe(1);
    expect(notifications.filter(Boolean)).toEqual([]);
    online = true;
    window.dispatchEvent(new Event('online'));
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id });
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id }] });
    expect(notifications.filter(Boolean)).toEqual(['Cambios sincronizados con la API.']);
    discardPeriodicTasks();
  }));

  it('no reintenta operaciones bloqueadas por un 422', fakeAsync(() => {
    start();
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({}, { status: 422, statusText: 'Invalid' });
    tick(AUTO_SYNC_INTERVAL_MS * 3);
    http.expectNone(() => true);
    expect(store.snapshot!.rejected?.status).toBe(422);
    expect(store.snapshot!.pending.length).toBe(1);
    expect(notifications.filter(Boolean)).toEqual([]);
    discardPeriodicTasks();
  }));

  it('un disparador periódico, manual y online no duplican el proceso en curso', fakeAsync(() => {
    start();
    const id = createAndFail();
    tick(AUTO_SYNC_INTERVAL_MS - 5000);
    store.update(id, { ...CONTACT, name: 'Más reciente' });
    const first = http.expectOne(`${url}/${id}`);
    tick(5000);
    sync.synchronize();
    window.dispatchEvent(new Event('online'));
    http.expectNone(() => true);
    first.flush({ ...CONTACT, id });
    const second = http.expectOne(`${url}/${id}`);
    expect(second.request.body.name).toBe('Más reciente');
    second.flush({ ...CONTACT, id, name: 'Más reciente' });
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id, name: 'Más reciente' }] });
    expect(notifications.filter(Boolean)).toEqual(['Cambios sincronizados con la API.']);
    discardPeriodicTasks();
  }));

  it('no confirma éxito si falla la persistencia del reconocimiento', fakeAsync(() => {
    start();
    const id = createAndFail();
    tick(AUTO_SYNC_INTERVAL_MS);
    memory.failWrite = true;
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id });
    expect(store.snapshot!.pending.length).toBe(1);
    expect(notifications.filter(Boolean)).toEqual([]);
    http.expectNone(url);
    discardPeriodicTasks();
  }));

  it('no confirma una sincronización completa si falla la descarga final', fakeAsync(() => {
    start();
    const id = createAndFail();
    tick(AUTO_SYNC_INTERVAL_MS);
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id });
    http.expectOne(url).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(notifications.filter(Boolean)).toEqual([]);
    expect(store.snapshot!.contacts[0].id).toBe(id);
    discardPeriodicTasks();
  }));

  it('no notifica cambios sincronizados por una simple consulta sin escrituras', fakeAsync(() => {
    start();
    sync.synchronize();
    http.expectOne(url).flush({ contacts: [CONTACT] });
    expect(notifications.filter(Boolean)).toEqual([]);
    discardPeriodicTasks();
  }));

  it('también notifica las ediciones guardadas mientras un GET estaba en curso', fakeAsync(() => {
    start();
    sync.synchronize();
    const oldGet = http.expectOne(url);
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    oldGet.flush({ contacts: [] });
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id });
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id }] });
    expect(notifications.filter(Boolean)).toEqual(['Cambios sincronizados con la API.']);
    discardPeriodicTasks();
  }));

  it('permite cerrar el aviso y lo limpia al guardar cambios nuevos', fakeAsync(() => {
    start();
    const id = createAndFail();
    tick(AUTO_SYNC_INTERVAL_MS);
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id });
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id }] });
    sync.dismissNotification();
    expect(notifications.at(-1)).toBeNull();
    store.update(id, { ...CONTACT, name: 'Nuevo' });
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id, name: 'Nuevo' });
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id, name: 'Nuevo' }] });
    expect(notifications.at(-1)).toBe('Cambios sincronizados con la API.');
    store.update(id, { ...CONTACT, name: 'Pendiente' });
    expect(notifications.at(-1)).toBeNull();
    http.expectOne(`${url}/${id}`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(notifications.at(-1)).toBeNull();
    discardPeriodicTasks();
  }));

  it('detiene el temporizador cuando se destruye el servicio', fakeAsync(() => {
    start();
    createAndFail();
    const synchronize = spyOn(sync, 'synchronize').and.callThrough();
    TestBed.resetTestingModule();
    tick(AUTO_SYNC_INTERVAL_MS * 2);
    expect(synchronize).not.toHaveBeenCalled();
    http.expectNone(() => true);
    discardPeriodicTasks();
  }));

  it('el reintento periódico confirmado también muestra una notificación del sistema si hay permiso', fakeAsync(() => {
    const browser = TestBed.inject(NOTIFICATIONS_BROWSER) as FakeNotificationsBrowser;
    browser.permission = 'granted';
    start();
    const id = createAndFail();
    expect(browser.ready).not.toHaveBeenCalled();
    tick(AUTO_SYNC_INTERVAL_MS);
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id });
    flushMicrotasks();
    expect(browser.ready).not.toHaveBeenCalled();
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id }] });
    flushMicrotasks();
    expect(browser.registration.showNotification).toHaveBeenCalledTimes(1);
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(store.snapshot!.pending).toEqual([]);
    discardPeriodicTasks();
  }));

  it('un fallo de notificación del sistema no cambia el éxito de la sincronización ni su aviso interno', fakeAsync(() => {
    const browser = TestBed.inject(NOTIFICATIONS_BROWSER) as FakeNotificationsBrowser;
    browser.permission = 'granted';
    browser.registration.showNotification.and.callFake(() => Promise.reject(new Error('OS failure')));
    start();
    const id = createAndFail();
    tick(AUTO_SYNC_INTERVAL_MS);
    http.expectOne(`${url}/${id}`).flush({ ...CONTACT, id });
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, id }] });
    flushMicrotasks();
    let phase: string | undefined;
    sync.status$.subscribe(value => phase = value.phase);
    expect(phase).toBe('synced');
    expect(store.snapshot!.pending).toEqual([]);
    expect(notifications.at(-1)).toBe('Cambios sincronizados con la API.');
    expect(TestBed.inject(SystemNotificationsService).snapshot.notice).toContain('No se pudo mostrar');
    discardPeriodicTasks();
  }));

  it('ni una descarga sin cambios ni una pasada fallida generan notificación del sistema aunque haya permiso', fakeAsync(() => {
    const browser = TestBed.inject(NOTIFICATIONS_BROWSER) as FakeNotificationsBrowser;
    browser.permission = 'granted';
    start();
    sync.synchronize();
    http.expectOne(url).flush({ contacts: [] });
    createAndFail();
    flushMicrotasks();
    expect(browser.ready).not.toHaveBeenCalled();
    expect(browser.registration.showNotification).not.toHaveBeenCalled();
    expect(browser.requestPermission).not.toHaveBeenCalled();
    discardPeriodicTasks();
  }));
});

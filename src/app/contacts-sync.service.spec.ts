import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE_URL } from './api.config';
import { Contact } from './contact';
import { ContactsStoreService } from './contacts-store.service';
import { ContactsSyncService, SyncStatus } from './contacts-sync.service';
import { LOCAL_STORAGE, LocalStorageError, STORAGE_KEY } from './local-storage.service';
import { CONTACT, MemoryStorage } from './testing/memory-storage';
import { NOTIFICATIONS_BROWSER } from './system-notifications.service';
import { FakeNotificationsBrowser } from './testing/fake-notifications-browser';

describe('ContactsSyncService', () => {
  let memory: MemoryStorage;
  let store: ContactsStoreService;
  let sync: ContactsSyncService;
  let http: HttpTestingController;
  let status: SyncStatus;
  let online: boolean;
  const url = 'http://test.invalid/api/contacts';

  function setOnline(value: boolean): void {
    online = value;
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  }

  function confirmPut(request: TestRequest, code = 200): Contact {
    const contact = { ...request.request.body, id: request.request.url.split('/').pop()! } as Contact;
    request.flush(contact, { status: code, statusText: 'OK' });
    return contact;
  }

  beforeEach(() => {
    memory = new MemoryStorage();
    online = true;
    spyOnProperty(navigator, 'onLine', 'get').and.callFake(() => online);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: API_BASE_URL, useValue: 'http://test.invalid' },
      { provide: LOCAL_STORAGE, useValue: memory },
      { provide: NOTIFICATIONS_BROWSER, useFactory: () => new FakeNotificationsBrowser() },
    ] });
    store = TestBed.inject(ContactsStoreService);
    sync = TestBed.inject(ContactsSyncService);
    http = TestBed.inject(HttpTestingController);
    sync.status$.subscribe(value => status = value);
  });
  afterEach(() => http.verify());

  it('consulta al iniciar y acepta una agenda vacía confirmada', () => {
    sync.synchronize();
    expect(status.phase).toBe('syncing');
    http.expectOne(url).flush({ contacts: [] });
    expect(status.phase).toBe('synced');
    expect(store.snapshot!.contacts).toEqual([]);
  });

  it('no crea procesos paralelos ante disparadores simultáneos', () => {
    sync.synchronize();
    sync.synchronize();
    window.dispatchEvent(new Event('online'));
    const request = http.expectOne(url);
    request.flush({ contacts: [] });
    expect(status.phase).toBe('synced');
  });

  it('guarda offline y envía crear → editar → borrar en orden, sin resucitar el contacto', () => {
    setOnline(false);
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    store.update(id, { ...CONTACT, name: 'Segunda versión' });
    store.delete(id);
    expect(status.phase).toBe('pending');
    http.expectNone(() => true);
    setOnline(true);
    const first = http.expectOne(`${url}/${id}`);
    expect(first.request.method).toBe('PUT');
    expect(first.request.body.name).toBe(CONTACT.name);
    http.expectNone(url);
    confirmPut(first, 201);
    const second = http.expectOne(`${url}/${id}`);
    expect(second.request.body.name).toBe('Segunda versión');
    confirmPut(second);
    const third = http.expectOne(`${url}/${id}`);
    expect(third.request.method).toBe('DELETE');
    third.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(url).flush({ contacts: [] });
    expect(store.snapshot!.contacts).toEqual([]);
    expect(store.snapshot!.pending).toEqual([]);
    expect(status.phase).toBe('synced');
  });

  it('conserva UUID y operación si se pierde la respuesta y reintenta sin duplicar', () => {
    store.create(CONTACT);
    const contact = store.snapshot!.contacts[0];
    const operation = store.snapshot!.pending[0];
    http.expectOne(`${url}/${contact.id}`).error(new ProgressEvent('error'));
    expect(status.issue?.kind).toBe('network');
    expect(store.snapshot!.pending[0]).toEqual(operation);
    sync.synchronize();
    const retry = http.expectOne(`${url}/${contact.id}`);
    expect(retry.request.body).toEqual({ name: contact.name, email: contact.email, phone: contact.phone });
    confirmPut(retry);
    http.expectOne(url).flush({ contacts: [contact] });
    expect(store.snapshot!.contacts).toEqual([contact]);
    expect(store.snapshot!.pending).toEqual([]);
  });

  it('un 5xx detiene la pasada y conserva todas las operaciones', () => {
    setOnline(false);
    store.create(CONTACT);
    store.create({ ...CONTACT, name: 'Otro' });
    const before = store.snapshot;
    setOnline(true);
    http.expectOne(`${url}/${before!.contacts[0].id}`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(store.snapshot).toBe(before);
    expect(status.phase).toBe('error');
    http.expectNone(() => true);
  });

  it('502, 503 y 504 conservan la cola y describen cambios sin sincronizar, no un error técnico', () => {
    store.create(CONTACT);
    const before = store.snapshot;
    const id = before!.contacts[0].id;
    for (const code of [502, 503, 504]) {
      if (code !== 502) sync.synchronize();
      http.expectOne(`${url}/${id}`).flush({}, { status: code, statusText: 'Unavailable' });
      expect(status.issue?.kind).toBe('network');
      expect(status.issue?.message).toContain('Los cambios locales todavía no están sincronizados');
      expect(status.issue?.message).not.toContain(String(code));
      expect(store.snapshot).toBe(before);
      expect(store.snapshot!.rejected).toBeUndefined();
      http.expectNone(() => true);
    }
  });

  it('no anuncia cambios sin sincronizar si falla la descarga con la cola vacía', () => {
    sync.synchronize();
    http.expectOne(url).flush({}, { status: 504, statusText: 'Gateway Timeout' });
    expect(status.issue?.kind).toBe('network');
    expect(status.issue?.message).toContain('No se pudo actualizar la agenda desde la API');
    expect(status.issue?.message).not.toContain('Los cambios locales');
    expect(store.snapshot!.pending).toEqual([]);
  });

  it('un 422 se persiste y no se reintenta por otros disparadores ni tras recargar', () => {
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({ detail: [] }, { status: 422, statusText: 'Invalid' });
    expect(status.issue?.kind).toBe('validation');
    sync.synchronize();
    window.dispatchEvent(new Event('online'));
    store.update(id, { ...CONTACT, name: 'Edición posterior' });
    http.expectNone(() => true);
    const saved = JSON.parse(memory.data.get(STORAGE_KEY)!);
    expect(saved.rejected.status).toBe(422);
    store.reload();
    sync.synchronize();
    http.expectNone(() => true);
    expect(store.snapshot!.pending.length).toBe(2);
  });

  it('la corrección explícita desbloquea el PUT sin cambiar su UUID', () => {
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({}, { status: 422, statusText: 'Invalid' });
    store.correctRejected({ ...CONTACT, name: 'Corregido' });
    const request = http.expectOne(`${url}/${id}`);
    expect(request.request.body.name).toBe('Corregido');
    const contact = confirmPut(request);
    http.expectOne(url).flush({ contacts: [contact] });
    expect(store.snapshot!.contacts[0].id).toBe(id);
    expect(store.snapshot!.pending).toEqual([]);
  });

  it('permite reintentar explícitamente un DELETE rechazado', () => {
    sync.synchronize();
    http.expectOne(url).flush({ contacts: [CONTACT] });
    store.delete(CONTACT.id);
    http.expectOne(`${url}/${CONTACT.id}`).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(store.snapshot!.rejected?.status).toBe(403);
    sync.synchronize();
    http.expectNone(() => true);
    store.retryRejected();
    const request = http.expectOne(`${url}/${CONTACT.id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(url).flush({ contacts: [] });
    expect(store.snapshot!.pending).toEqual([]);
  });

  it('un reconocimiento PUT no sobrescribe la edición hecha durante la petición', () => {
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    const first = http.expectOne(`${url}/${id}`);
    store.update(id, { ...CONTACT, name: 'Más nuevo' });
    sync.synchronize();
    http.expectNone(() => true);
    confirmPut(first);
    expect(store.snapshot!.contacts[0].name).toBe('Más nuevo');
    expect(store.snapshot!.pending.length).toBe(1);
    const second = http.expectOne(`${url}/${id}`);
    expect(second.request.body.name).toBe('Más nuevo');
    const contact = confirmPut(second);
    http.expectOne(url).flush({ contacts: [contact] });
    expect(store.snapshot!.contacts[0].name).toBe('Más nuevo');
  });

  it('un GET antiguo no borra cambios creados mientras estaba en curso', () => {
    sync.synchronize();
    const oldGet = http.expectOne(url);
    store.create(CONTACT);
    const contact = store.snapshot!.contacts[0];
    oldGet.flush({ contacts: [] });
    expect(store.snapshot!.contacts).toEqual([contact]);
    const put = http.expectOne(`${url}/${contact.id}`);
    confirmPut(put, 201);
    http.expectOne(url).flush({ contacts: [contact] });
    expect(store.snapshot!.contacts).toEqual([contact]);
  });

  it('un GET antiguo no resucita un contacto eliminado durante la consulta', () => {
    sync.synchronize();
    http.expectOne(url).flush({ contacts: [CONTACT] });
    sync.synchronize();
    const oldGet = http.expectOne(url);
    store.delete(CONTACT.id);
    oldGet.flush({ contacts: [CONTACT] });
    expect(store.snapshot!.contacts).toEqual([]);
    http.expectOne(`${url}/${CONTACT.id}`).flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(url).flush({ contacts: [] });
    expect(store.snapshot!.contacts).toEqual([]);
  });

  it('una lista inválida no reemplaza la agenda local', () => {
    sync.synchronize();
    http.expectOne(url).flush({ contacts: [CONTACT] });
    sync.synchronize();
    http.expectOne(url).flush({ contacts: [{ ...CONTACT, phone: null }] });
    expect(store.snapshot!.contacts).toEqual([CONTACT]);
    expect(status.issue?.kind).toBe('response');
  });

  it('un fallo al descargar tras confirmar PUT conserva la agenda y no reencola el PUT', () => {
    store.create(CONTACT);
    const contact = store.snapshot!.contacts[0];
    confirmPut(http.expectOne(`${url}/${contact.id}`));
    http.expectOne(url).flush({}, { status: 500, statusText: 'Error' });
    expect(store.snapshot!.contacts).toEqual([contact]);
    expect(store.snapshot!.pending).toEqual([]);
    expect(status.phase).toBe('error');
  });

  it('una respuesta PUT inválida conserva y bloquea la operación', () => {
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({ name: 'sin id' });
    expect(store.snapshot!.pending.length).toBe(1);
    expect(store.snapshot!.rejected?.status).toBeNull();
    expect(status.issue?.kind).toBe('response');
    sync.synchronize();
    http.expectNone(() => true);
  });

  it('si falla el guardado del reconocimiento no avanza a la siguiente operación', () => {
    store.create(CONTACT);
    const first = store.snapshot!.pending[0];
    const id = store.snapshot!.contacts[0].id;
    const request = http.expectOne(`${url}/${id}`);
    store.update(id, { ...CONTACT, name: 'Después' });
    memory.failWrite = true;
    confirmPut(request);
    expect(store.snapshot!.pending.length).toBe(2);
    expect(store.snapshot!.pending[0]).toEqual(first);
    expect(status.issue?.kind).toBe('storage');
    http.expectNone(() => true);
    memory.failWrite = false;
    sync.synchronize();
    confirmPut(http.expectOne(`${url}/${id}`));
    const contact = confirmPut(http.expectOne(`${url}/${id}`));
    http.expectOne(url).flush({ contacts: [contact] });
    expect(store.snapshot!.pending).toEqual([]);
  });

  it('si no se pudo guardar una edición no llega a la API', () => {
    memory.failWrite = true;
    expect(() => store.create(CONTACT)).toThrowError(LocalStorageError);
    http.expectNone(() => true);
    expect(store.snapshot!.pending).toEqual([]);
  });

  it('un fallo de escritura al reconciliar no reemplaza la agenda', () => {
    sync.synchronize();
    http.expectOne(url).flush({ contacts: [CONTACT] });
    sync.synchronize();
    memory.failWrite = true;
    http.expectOne(url).flush({ contacts: [] });
    expect(store.snapshot!.contacts).toEqual([CONTACT]);
    expect(status.issue?.kind).toBe('storage');
  });

  it('un timeout desbloquea el proceso sin bucles de reintento', fakeAsync(() => {
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    const request = http.expectOne(`${url}/${id}`);
    tick(10000);
    expect(request.cancelled).toBeTrue();
    expect(store.snapshot!.pending.length).toBe(1);
    expect(status.issue?.kind).toBe('network');
    tick(60000);
    http.expectNone(() => true);
    sync.synchronize();
    const contact = confirmPut(http.expectOne(`${url}/${id}`));
    http.expectOne(url).flush({ contacts: [contact] });
  }));

  it('no reenvía automáticamente un documento local corrupto', () => {
    memory.data.set(STORAGE_KEY, '{ilegible');
    // Recrea el módulo para simular el arranque real con ese documento.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: LOCAL_STORAGE, useValue: memory },
      { provide: NOTIFICATIONS_BROWSER, useFactory: () => new FakeNotificationsBrowser() },
    ] });
    const unreadable = TestBed.inject(ContactsStoreService);
    TestBed.inject(ContactsSyncService).synchronize();
    TestBed.inject(HttpTestingController).expectNone(() => true);
    expect(unreadable.snapshot).toBeNull();
    expect(memory.data.get(STORAGE_KEY)).toBe('{ilegible');
  });
});

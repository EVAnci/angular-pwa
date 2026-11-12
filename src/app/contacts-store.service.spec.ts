import { TestBed } from '@angular/core/testing';
import { ContactValidationError } from './contact';
import { ContactsStoreService } from './contacts-store.service';
import { LOCAL_STORAGE, LocalStorageError, LocalStorageService, STORAGE_KEY } from './local-storage.service';
import { CONTACT, MemoryStorage } from './testing/memory-storage';

describe('ContactsStoreService', () => {
  let memory: MemoryStorage;
  let store: ContactsStoreService;

  beforeEach(() => {
    memory = new MemoryStorage();
    TestBed.configureTestingModule({ providers: [{ provide: LOCAL_STORAGE, useValue: memory }] });
    store = TestBed.inject(ContactsStoreService);
  });

  it('persiste agenda y cola antes de publicar el cambio', () => {
    store.state$.subscribe(state => {
      if (state?.pending.length) {
        expect(JSON.parse(memory.data.get(STORAGE_KEY)!)).toEqual(state);
      }
    });
    store.create({ name: '  Ana  ', email: '', phone: '' });
    expect(store.snapshot!.contacts[0].name).toBe('Ana');
    expect(store.snapshot!.contacts[0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(memory.writes).toBe(1);
  });

  it('conserva payloads inmutables y no compacta las ediciones', () => {
    const fields = { name: 'Primero', email: '', phone: '' };
    store.create(fields);
    const id = store.snapshot!.contacts[0].id;
    fields.name = 'Fuera del servicio';
    store.update(id, { ...fields, name: 'Segundo' });
    const pending = store.snapshot!.pending;
    expect(pending.length).toBe(2);
    expect(pending[0].type === 'put' && pending[0].contact.name).toBe('Primero');
    expect(pending[1].type === 'put' && pending[1].contact.name).toBe('Segundo');
    expect(pending[0].operationId).not.toBe(pending[1].operationId);
    expect(Object.isFrozen(pending[0])).toBeTrue();
  });

  it('restaura agenda y eliminaciones pendientes después de recargar', () => {
    store.create(CONTACT);
    const id = store.snapshot!.contacts[0].id;
    store.update(id, { ...CONTACT, name: 'Editado' });
    store.delete(id);
    const restored = new ContactsStoreService(TestBed.inject(LocalStorageService));
    expect(restored.snapshot!.contacts).toEqual([]);
    expect(restored.snapshot!.pending.map(operation => operation.type)).toEqual(['put', 'put', 'delete']);
  });

  it('un fallo de escritura no publica, no encola y no anuncia un cambio', () => {
    let changes = 0;
    store.changes$.subscribe(() => changes++);
    const before = store.snapshot;
    memory.failWrite = true;
    expect(() => store.create(CONTACT)).toThrowError(LocalStorageError);
    expect(store.snapshot).toBe(before);
    expect(changes).toBe(0);
  });

  it('valida el nombre antes de guardar y no impone formato de correo o teléfono', () => {
    expect(() => store.create({ name: '   ', email: '', phone: '' })).toThrowError(ContactValidationError);
    expect(memory.writes).toBe(0);
    store.create({ name: 'Ana', email: 'sin formato', phone: 'ext. abc' });
    expect(store.snapshot!.contacts[0].email).toBe('sin formato');
  });

  it('retira por operationId sin perder operaciones nuevas', () => {
    store.create(CONTACT);
    const operationId = store.snapshot!.pending[0].operationId;
    const id = store.snapshot!.contacts[0].id;
    store.update(id, { ...CONTACT, name: 'Nuevo' });
    store.acknowledge(operationId);
    expect(store.snapshot!.pending.length).toBe(1);
    expect(store.snapshot!.contacts[0].name).toBe('Nuevo');
  });

  it('no retira la operación si falla la persistencia del reconocimiento', () => {
    store.create(CONTACT);
    const before = store.snapshot;
    memory.failWrite = true;
    expect(() => store.acknowledge(before!.pending[0].operationId)).toThrowError(LocalStorageError);
    expect(store.snapshot).toBe(before);
  });

  it('impide reconciliar con pendientes o una revisión antigua', () => {
    const revision = store.revision;
    store.create(CONTACT);
    expect(store.reconcile([], store.revision)).toBeFalse();
    store.acknowledge(store.snapshot!.pending[0].operationId);
    expect(store.reconcile([], revision)).toBeFalse();
    expect(store.snapshot!.contacts.length).toBe(1);
    expect(store.reconcile([], store.revision)).toBeTrue();
    expect(store.snapshot!.contacts.length).toBe(0);
  });

  it('bloquea ediciones sobre un documento ilegible hasta recuperación explícita', () => {
    memory.data.set(STORAGE_KEY, '{mal');
    const unreadable = new ContactsStoreService(TestBed.inject(LocalStorageService));
    expect(unreadable.snapshot).toBeNull();
    expect(() => unreadable.create(CONTACT)).toThrowError(LocalStorageError);
    expect(memory.data.get(STORAGE_KEY)).toBe('{mal');
    unreadable.resetUnreadableState();
    expect(unreadable.snapshot!.pending).toEqual([]);
    expect(JSON.parse(memory.data.get(STORAGE_KEY)!)).toEqual(unreadable.snapshot);
  });

  it('corrige explícitamente un PUT rechazado con otro operationId', () => {
    store.create(CONTACT);
    const original = store.snapshot!.pending[0];
    store.reject({ operationId: original.operationId, status: 422, message: 'Rechazado' });
    store.correctRejected({ ...CONTACT, name: 'Corregido' });
    expect(store.snapshot!.rejected).toBeUndefined();
    expect(store.snapshot!.pending[0].operationId).not.toBe(original.operationId);
    expect(store.snapshot!.contacts[0].name).toBe('Corregido');
  });

  it('corregir un rechazo no pisa una edición posterior del mismo contacto', () => {
    store.create(CONTACT);
    const original = store.snapshot!.pending[0];
    store.reject({ operationId: original.operationId, status: 422, message: 'Rechazado' });
    store.update(store.snapshot!.contacts[0].id, { ...CONTACT, name: 'Más reciente' });
    const later = store.snapshot!.pending[1];
    store.correctRejected({ ...CONTACT, name: 'Corregido antiguo' });
    expect(store.snapshot!.contacts[0].name).toBe('Más reciente');
    expect(store.snapshot!.pending[1]).toEqual(later);
  });

  it('corregir una operación anterior a DELETE no resucita el contacto', () => {
    store.create(CONTACT);
    store.reject({ operationId: store.snapshot!.pending[0].operationId, status: 422, message: 'Rechazado' });
    store.delete(store.snapshot!.contacts[0].id);
    store.correctRejected({ ...CONTACT, name: 'Corregido' });
    expect(store.snapshot!.contacts).toEqual([]);
    expect(store.snapshot!.pending.map(operation => operation.type)).toEqual(['put', 'delete']);
  });
});

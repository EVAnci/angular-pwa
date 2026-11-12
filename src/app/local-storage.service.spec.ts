import { TestBed } from '@angular/core/testing';
import { LOCAL_STORAGE, LocalStorageError, LocalStorageService, STORAGE_KEY, emptyState } from './local-storage.service';
import { CONTACT, MemoryStorage, OPERATION_ID } from './testing/memory-storage';

describe('LocalStorageService', () => {
  let memory: MemoryStorage;
  let storage: LocalStorageService;

  beforeEach(() => {
    memory = new MemoryStorage();
    TestBed.configureTestingModule({ providers: [{ provide: LOCAL_STORAGE, useValue: memory }] });
    storage = TestBed.inject(LocalStorageService);
  });

  it('acepta un dispositivo sin datos y no escribe al leer', () => {
    expect(storage.read()).toEqual(emptyState());
    expect(memory.writes).toBe(0);
  });

  it('guarda contactos y eliminaciones pendientes en una sola escritura', () => {
    const state = {
      version: 1 as const, contacts: [CONTACT],
      pending: [{ operationId: OPERATION_ID, type: 'delete' as const, contactId: CONTACT.id }],
    };
    storage.write(state);
    expect(memory.writes).toBe(1);
    expect(storage.read()).toEqual(state);
  });

  it('conserva JSON corrupto sin sobrescribirlo', () => {
    memory.data.set(STORAGE_KEY, '{corrupto');
    expect(() => storage.read()).toThrowError(LocalStorageError, /JSON/);
    expect(memory.data.get(STORAGE_KEY)).toBe('{corrupto');
    expect(memory.writes).toBe(0);
  });

  it('rechaza versiones desconocidas sin descartarlas', () => {
    memory.data.set(STORAGE_KEY, JSON.stringify({ ...emptyState(), version: 2 }));
    expect(() => storage.read()).toThrowError(LocalStorageError, /versión/);
    expect(memory.writes).toBe(0);
  });

  it('rechaza contactos inválidos, UUID inválidos y listas duplicadas', () => {
    for (const contacts of [
      [{ ...CONTACT, name: '  ' }], [{ ...CONTACT, id: 'no-uuid' }],
      [{ ...CONTACT, email: null }], [CONTACT, CONTACT],
    ]) {
      memory.data.set(STORAGE_KEY, JSON.stringify({ ...emptyState(), contacts }));
      expect(() => storage.read()).toThrowError(LocalStorageError);
    }
  });

  it('rechaza operaciones inválidas o con identificadores repetidos', () => {
    const operation = { operationId: OPERATION_ID, type: 'put', contact: CONTACT };
    for (const pending of [
      [{ ...operation, type: 'post' }], [{ ...operation, contact: null }],
      [{ type: 'delete', operationId: OPERATION_ID, contactId: 1 }], [operation, operation],
    ]) {
      memory.data.set(STORAGE_KEY, JSON.stringify({ ...emptyState(), pending }));
      expect(() => storage.read()).toThrowError(LocalStorageError);
    }
  });

  it('no acepta un bloqueo que no corresponda a la cabeza de la cola', () => {
    for (const rejected of [
      { operationId: OPERATION_ID, status: 422, message: 'Error' },
      { status: null, message: 'Falta operationId' },
    ]) {
      memory.data.set(STORAGE_KEY, JSON.stringify({ ...emptyState(), rejected }));
      expect(() => storage.read()).toThrowError(LocalStorageError);
    }
  });

  it('informa errores de acceso y de cuota sin alterar el documento anterior', () => {
    memory.failRead = true;
    expect(() => storage.read()).toThrowError(LocalStorageError, /leer/);
    memory.failRead = false;
    storage.write(emptyState());
    const before = memory.data.get(STORAGE_KEY);
    memory.failWrite = true;
    expect(() => storage.write({ ...emptyState(), contacts: [CONTACT] })).toThrowError(LocalStorageError, /guardar/);
    expect(memory.data.get(STORAGE_KEY)).toBe(before);
  });
});

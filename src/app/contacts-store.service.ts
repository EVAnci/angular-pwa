import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { Contact, ContactFields, ContactValidationError, copyContact, normalizeFields } from './contact';
import {
  LocalState, LocalStorageError, LocalStorageService, RejectedOperation, emptyState, parseLocalState,
} from './local-storage.service';

@Injectable({ providedIn: 'root' })
export class ContactsStoreService {
  private readonly stateSubject = new BehaviorSubject<LocalState | null>(null);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  private readonly changesSubject = new Subject<void>();
  readonly state$ = this.stateSubject.asObservable();
  readonly storageError$ = this.errorSubject.asObservable();
  readonly changes$ = this.changesSubject.asObservable();
  private localRevision = 0;

  constructor(private readonly storage: LocalStorageService) {
    this.reload();
  }

  get snapshot(): LocalState | null { return this.stateSubject.value; }
  get revision(): number { return this.localRevision; }

  reload(): void {
    try {
      this.publish(this.storage.read());
      this.errorSubject.next(null);
    } catch (error) {
      this.reportStorageError(error);
    }
  }

  resetUnreadableState(): void {
    if (this.snapshot !== null) return;
    this.save(emptyState());
    this.changesSubject.next();
  }

  create(fields: ContactFields): void {
    const contact = { id: crypto.randomUUID(), ...normalizeFields(fields) };
    this.put(contact);
  }

  update(id: string, fields: ContactFields): void {
    if (!this.requireState().contacts.some(contact => contact.id === id)) {
      throw new ContactValidationError('Este contacto ya no está en la agenda.');
    }
    this.put({ id, ...normalizeFields(fields) });
  }

  private put(contact: Contact): void {
    const state = this.requireState();
    const exists = state.contacts.some(item => item.id === contact.id);
    this.save({
      ...state,
      contacts: exists ? state.contacts.map(item => item.id === contact.id ? contact : item)
        : [...state.contacts, contact],
      pending: [...state.pending, { operationId: crypto.randomUUID(), type: 'put', contact }],
    });
    this.changesSubject.next();
  }

  delete(id: string): void {
    const state = this.requireState();
    if (!state.contacts.some(contact => contact.id === id)) {
      throw new ContactValidationError('Este contacto ya no está en la agenda.');
    }
    this.save({
      ...state,
      contacts: state.contacts.filter(contact => contact.id !== id),
      pending: [...state.pending, { operationId: crypto.randomUUID(), type: 'delete', contactId: id }],
    });
    this.changesSubject.next();
  }

  acknowledge(operationId: string): void {
    const state = this.requireState();
    const { rejected, ...rest } = state;
    this.save({
      ...rest,
      pending: state.pending.filter(operation => operation.operationId !== operationId),
      ...(rejected && rejected.operationId !== operationId ? { rejected } : {}),
    });
  }

  reject(rejected: RejectedOperation): void {
    const state = this.requireState();
    if (state.pending[0]?.operationId === rejected.operationId) {
      this.save({ ...state, rejected });
    }
  }

  retryRejected(): void {
    const { rejected, ...state } = this.requireState();
    if (rejected) this.save(state);
    this.changesSubject.next();
  }

  correctRejected(fields: ContactFields): void {
    const state = this.requireState();
    const operation = state.pending[0];
    if (!state.rejected || operation?.type !== 'put') {
      throw new ContactValidationError('No hay un guardado rechazado que corregir.');
    }
    const contact = { id: operation.contact.id, ...normalizeFields(fields) };
    const { rejected, ...rest } = state;
    const hasLaterChanges = state.pending.slice(1).some(item =>
      (item.type === 'put' ? item.contact.id : item.contactId) === contact.id);
    // Solo esta acción explícita sustituye el payload rechazado, con otro operationId.
    // Las operaciones posteriores conservan su orden y sus datos.
    this.save({
      ...rest,
      contacts: hasLaterChanges ? state.contacts
        : state.contacts.map(item => item.id === contact.id ? contact : item),
      pending: [
        { operationId: crypto.randomUUID(), type: 'put', contact }, ...state.pending.slice(1),
      ],
    });
    this.changesSubject.next();
  }

  reconcile(contacts: readonly Contact[], expectedRevision: number): boolean {
    const state = this.requireState();
    if (state.pending.length || this.revision !== expectedRevision) return false;
    this.save({ version: 1, contacts: contacts.map(copyContact), pending: [] });
    return true;
  }

  private requireState(): LocalState {
    if (!this.snapshot) throw new LocalStorageError('Resuelve el error de almacenamiento antes de editar o sincronizar.');
    return this.snapshot;
  }

  private save(state: LocalState): void {
    try {
      const next = parseLocalState(state);
      this.storage.write(next);
      this.publish(next);
      this.errorSubject.next(null);
    } catch (error) {
      this.reportStorageError(error);
      throw error;
    }
  }

  private publish(state: LocalState): void {
    // Las instantáneas públicas y los payloads nunca se modifican en el sitio.
    for (const contact of state.contacts) Object.freeze(contact);
    for (const operation of state.pending) {
      if (operation.type === 'put') Object.freeze(operation.contact);
      Object.freeze(operation);
    }
    Object.freeze(state.contacts);
    Object.freeze(state.pending);
    if (state.rejected) Object.freeze(state.rejected);
    this.localRevision++;
    this.stateSubject.next(Object.freeze(state));
  }

  private reportStorageError(error: unknown): void {
    this.errorSubject.next(error instanceof LocalStorageError ? error.message : 'Error inesperado del almacenamiento local.');
  }
}

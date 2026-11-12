import { Inject, Injectable, InjectionToken } from '@angular/core';
import { Contact, copyContact, isContact, isRecord, isUuid } from './contact';

export type PendingOperation =
  | { readonly operationId: string; readonly type: 'put'; readonly contact: Contact }
  | { readonly operationId: string; readonly type: 'delete'; readonly contactId: string };

export interface RejectedOperation {
  readonly operationId: string;
  readonly status: number | null;
  readonly message: string;
}

export interface LocalState {
  readonly version: 1;
  readonly contacts: readonly Contact[];
  readonly pending: readonly PendingOperation[];
  // Se persiste el bloqueo para no reenviar un 422 automáticamente tras recargar.
  readonly rejected?: RejectedOperation;
}

export const STORAGE_KEY = 'pwa-contacts.state.v1';
export type LocalStoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export const LOCAL_STORAGE = new InjectionToken<LocalStoragePort>('LOCAL_STORAGE', {
  providedIn: 'root',
  // El acceso puede fallar incluso al obtener window.localStorage.
  factory: () => ({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  }),
});

export class LocalStorageError extends Error {}

export function emptyState(): LocalState {
  return { version: 1, contacts: [], pending: [] };
}

function isOperation(value: unknown): value is PendingOperation {
  if (!isRecord(value) || !isUuid(value['operationId'])) return false;
  return value['type'] === 'put' ? isContact(value['contact'])
    : value['type'] === 'delete' && isUuid(value['contactId']);
}

export function copyOperation(operation: PendingOperation): PendingOperation {
  return operation.type === 'put'
    ? { operationId: operation.operationId, type: 'put', contact: copyContact(operation.contact) }
    : { operationId: operation.operationId, type: 'delete', contactId: operation.contactId };
}

export function parseLocalState(value: unknown): LocalState {
  if (!isRecord(value) || value['version'] !== 1) {
    throw new LocalStorageError('El almacenamiento tiene un formato o una versión no compatible. No se modificó.');
  }
  const contacts = value['contacts'];
  const pending = value['pending'];
  if (!Array.isArray(contacts) || !contacts.every(isContact)
    || new Set(contacts.map(contact => contact.id)).size !== contacts.length
    || !Array.isArray(pending) || !pending.every(isOperation)
    || new Set(pending.map(operation => operation.operationId)).size !== pending.length) {
    throw new LocalStorageError('Los contactos o la cola local tienen un formato inválido. No se modificaron.');
  }
  const rejected = value['rejected'];
  if (rejected !== undefined && (!isRecord(rejected)
    || !isUuid(rejected['operationId'])
    || rejected['operationId'] !== pending[0]?.operationId
    || typeof rejected['message'] !== 'string'
    || !(rejected['status'] === null || (Number.isInteger(rejected['status'])
      && Number(rejected['status']) >= 400 && Number(rejected['status']) < 500)))) {
    throw new LocalStorageError('La operación bloqueada del almacenamiento es inválida. No se modificó.');
  }
  return {
    version: 1,
    contacts: contacts.map(copyContact),
    pending: pending.map(copyOperation),
    ...(rejected === undefined ? {} : { rejected: {
      operationId: String(rejected['operationId']),
      status: rejected['status'] === null ? null : Number(rejected['status']),
      message: String(rejected['message']),
    } }),
  };
}

@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  constructor(@Inject(LOCAL_STORAGE) private readonly storage: LocalStoragePort) {}

  read(): LocalState {
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      throw new LocalStorageError('No se pudo leer el almacenamiento del dispositivo. Comprueba los permisos del navegador.');
    }
    if (raw === null) return emptyState();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LocalStorageError('El JSON local está dañado. Se conservó intacto; la agenda no se enviará ni reemplazará.');
    }
    return parseLocalState(parsed);
  }

  write(state: LocalState): void {
    try {
      // Una única escritura contiene tanto los contactos como la cola.
      this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      throw new LocalStorageError('No se pudo guardar en el dispositivo (espacio o permisos). El cambio no quedó guardado.');
    }
  }
}

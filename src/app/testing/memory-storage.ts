import { Contact } from '../contact';
import { LocalStoragePort } from '../local-storage.service';

// Nunca accede al almacenamiento real del navegador.
export class MemoryStorage implements LocalStoragePort {
  readonly data = new Map<string, string>();
  failRead = false;
  failWrite = false;
  writes = 0;

  getItem(key: string): string | null {
    if (this.failRead) throw new Error('Storage unavailable');
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('Quota exceeded');
    this.writes++;
    this.data.set(key, value);
  }
}

export const CONTACT_ID = '4e2590d7-4ab5-4aef-8e13-ff063cf82c3c';
export const OPERATION_ID = '5e2590d7-4ab5-4aef-8e13-ff063cf82c3c';
export const CONTACT: Contact = {
  id: CONTACT_ID, name: 'Ana Ficticia', email: 'ana@example.com', phone: '+54 11 0000 0000',
};

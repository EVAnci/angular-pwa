export interface Contact {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}

export type ContactFields = Omit<Contact, 'id'>;

export class InvalidResponseError extends Error {}
export class ContactValidationError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function isContact(value: unknown): value is Contact {
  return isRecord(value) && isUuid(value['id'])
    && typeof value['name'] === 'string' && value['name'].trim().length > 0
    && typeof value['email'] === 'string' && typeof value['phone'] === 'string';
}

export function copyContact(contact: Contact): Contact {
  return { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone };
}

export function normalizeFields(fields: ContactFields): ContactFields {
  if (typeof fields.name !== 'string' || !fields.name.trim()) {
    throw new ContactValidationError('El nombre es obligatorio y no puede contener solo espacios.');
  }
  if (typeof fields.email !== 'string' || typeof fields.phone !== 'string') {
    throw new ContactValidationError('El correo y el teléfono deben ser textos.');
  }
  return { name: fields.name.trim(), email: fields.email, phone: fields.phone };
}

export function parseContact(body: unknown, expectedId?: string): Contact {
  if (!isContact(body) || (expectedId !== undefined && body.id !== expectedId)) {
    throw new InvalidResponseError('La API devolvió un contacto con un formato o identificador inesperado.');
  }
  return copyContact(body);
}

export function parseContacts(body: unknown): Contact[] {
  const contacts = isRecord(body) ? body['contacts'] : undefined;
  if (!Array.isArray(contacts) || !contacts.every(isContact)
    || new Set(contacts.map(contact => contact.id)).size !== contacts.length) {
    throw new InvalidResponseError('La API devolvió una lista de contactos con un formato inesperado.');
  }
  return contacts.map(copyContact);
}

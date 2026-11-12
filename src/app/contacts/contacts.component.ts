import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { combineLatest, map } from 'rxjs';
import { Contact, ContactFields, ContactValidationError } from '../contact';
import { ContactsStoreService } from '../contacts-store.service';
import { ContactsSyncService } from '../contacts-sync.service';
import { LocalStorageError } from '../local-storage.service';
import { SystemNotificationsService } from '../system-notifications.service';

@Component({
  selector: 'app-contacts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contacts.component.html',
})
export class ContactsComponent implements OnInit {
  readonly store = inject(ContactsStoreService);
  readonly sync = inject(ContactsSyncService);
  readonly systemNotifications = inject(SystemNotificationsService);
  readonly vm$ = combineLatest({
    state: this.store.state$,
    storageError: this.store.storageError$,
    sync: this.sync.status$,
    syncNotification: this.sync.notification$,
    systemNotifications: this.systemNotifications.state$,
    online: this.sync.online$,
  }).pipe(map(vm => ({
    ...vm,
    rejectedPut: vm.state?.rejected && vm.state.pending[0]?.type === 'put'
      ? vm.state.pending[0] : null,
  })));

  search = '';
  formOpen = false;
  editingId: string | null = null;
  correcting = false;
  fields: ContactFields = this.emptyFields();
  formError: string | null = null;
  feedback: { kind: 'success' | 'error'; message: string } | null = null;

  ngOnInit(): void { this.sync.synchronize(); }

  visibleContacts(contacts: readonly Contact[]): readonly Contact[] {
    const query = this.search.trim().toLocaleLowerCase();
    return contacts.filter(contact => [contact.name, contact.email, contact.phone]
      .some(field => field.toLocaleLowerCase().includes(query)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  openForm(contact?: Contact): void {
    this.editingId = contact?.id ?? null;
    this.correcting = false;
    this.fields = contact ? { name: contact.name, email: contact.email, phone: contact.phone } : this.emptyFields();
    this.formError = null;
    this.feedback = null;
    this.formOpen = true;
  }

  openCorrection(): void {
    const operation = this.store.snapshot?.pending[0];
    if (operation?.type !== 'put' || !this.store.snapshot?.rejected) return;
    this.openForm(operation.contact);
    this.correcting = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.formError = null;
    this.correcting = false;
  }

  save(): void {
    this.formError = null;
    this.feedback = null;
    try {
      if (this.correcting) this.store.correctRejected(this.fields);
      else if (this.editingId) this.store.update(this.editingId, this.fields);
      else this.store.create(this.fields);
      this.feedback = { kind: 'success', message: 'Cambios locales guardados.' };
      this.closeForm();
    } catch (error) {
      this.formError = this.describeLocalError(error);
    }
  }

  delete(contact: Contact): void {
    if (!window.confirm(`¿Eliminar a ${contact.name}? La eliminación se guardará en este dispositivo y quedará pendiente de sincronización.`)) return;
    this.feedback = null;
    try {
      this.store.delete(contact.id);
      if (this.editingId === contact.id) this.closeForm();
      this.feedback = { kind: 'success', message: 'Cambios locales guardados.' };
    } catch (error) {
      this.feedback = { kind: 'error', message: this.describeLocalError(error) };
    }
  }

  retryRejected(): void {
    this.feedback = null;
    try {
      this.store.retryRejected();
    } catch (error) {
      this.feedback = { kind: 'error', message: this.describeLocalError(error) };
    }
  }

  recover(): void {
    if (!window.confirm('Esto reemplazará el documento local ilegible y eliminará los contactos y pendientes que contenga. No afecta al servidor. Antes puedes copiar la clave pwa-contacts.state.v1 desde DevTools → Application → Local Storage. ¿Restablecer?')) return;
    try {
      this.store.resetUnreadableState();
      this.feedback = { kind: 'success', message: 'Almacenamiento local restablecido explícitamente.' };
    } catch (error) {
      this.feedback = { kind: 'error', message: this.describeLocalError(error) };
    }
  }

  trackById(_index: number, contact: Contact): string { return contact.id; }

  private emptyFields(): ContactFields { return { name: '', email: '', phone: '' }; }

  private describeLocalError(error: unknown): string {
    return error instanceof ContactValidationError || error instanceof LocalStorageError
      ? error.message : 'No se pudo realizar el cambio. No se anunció como guardado.';
  }
}

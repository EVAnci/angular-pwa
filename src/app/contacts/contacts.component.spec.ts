import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ContactsComponent } from './contacts.component';
import { API_BASE_URL } from '../api.config';
import { LOCAL_STORAGE } from '../local-storage.service';
import { CONTACT, MemoryStorage } from '../testing/memory-storage';
import { NOTIFICATIONS_BROWSER } from '../system-notifications.service';
import { FakeNotificationsBrowser } from '../testing/fake-notifications-browser';

describe('ContactsComponent', () => {
  let fixture: ComponentFixture<ContactsComponent>;
  let component: ContactsComponent;
  let http: HttpTestingController;
  let memory: MemoryStorage;
  let onlineGetter: jasmine.Spy;
  let notificationsBrowser: FakeNotificationsBrowser;
  const url = 'http://test.invalid/api/contacts';
  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    memory = new MemoryStorage();
    notificationsBrowser = new FakeNotificationsBrowser();
    onlineGetter = spyOnProperty(navigator, 'onLine', 'get').and.returnValue(true);
    await TestBed.configureTestingModule({
      imports: [ContactsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://test.invalid' },
        { provide: LOCAL_STORAGE, useValue: memory },
        { provide: NOTIFICATIONS_BROWSER, useValue: notificationsBrowser }],
    }).compileComponents();
    fixture = TestBed.createComponent(ContactsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('distingue agenda vacía de búsqueda sin resultados', () => {
    http.expectOne(url).flush({ contacts: [] });
    fixture.detectChanges();
    expect(text()).toContain('No hay contactos en la agenda local');
    component.sync.synchronize();
    http.expectOne(url).flush({ contacts: [CONTACT] });
    component.search = 'no-coincide';
    fixture.detectChanges();
    expect(text()).toContain('No hay contactos que coincidan');
    expect(text()).not.toContain('No hay contactos en la agenda local');
  });

  it('busca por nombre, correo y teléfono sin distinguir mayúsculas', () => {
    http.expectOne(url).flush({ contacts: [CONTACT] });
    for (const query of ['ANA', 'EXAMPLE.COM', '0000']) {
      component.search = query;
      expect(component.visibleContacts(component.store.snapshot!.contacts)).toEqual([CONTACT]);
    }
  });

  it('el formulario rechaza un nombre vacío sin cerrar ni encolar', () => {
    http.expectOne(url).flush({ contacts: [] });
    component.openForm();
    component.fields = { name: '  ', email: '', phone: '' };
    component.save();
    fixture.detectChanges();
    expect(component.formOpen).toBeTrue();
    expect(text()).toContain('El nombre es obligatorio');
    expect(component.store.snapshot!.pending).toEqual([]);
  });

  it('mantiene el formulario y no anuncia éxito ante una escritura fallida', () => {
    http.expectOne(url).flush({ contacts: [] });
    memory.failWrite = true;
    component.openForm();
    component.fields = { name: 'Ana', email: '', phone: '' };
    component.save();
    fixture.detectChanges();
    expect(component.formOpen).toBeTrue();
    expect(component.feedback).toBeNull();
    expect(text()).toContain('El cambio no quedó guardado');
    expect(fixture.nativeElement.querySelector('.feedback.success')).toBeNull();
    http.expectNone(() => true);
  });

  it('cancelar la confirmación no elimina ni envía el contacto', () => {
    http.expectOne(url).flush({ contacts: [CONTACT] });
    spyOn(window, 'confirm').and.returnValue(false);
    component.delete(CONTACT);
    expect(component.store.snapshot!.contacts).toEqual([CONTACT]);
    http.expectNone(() => true);
  });

  it('muestra un aviso de API no disponible sin ocultar contactos', () => {
    http.expectOne(url).flush({ contacts: [CONTACT] });
    component.sync.synchronize();
    http.expectOne(url).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain(CONTACT.name);
    expect(text()).toContain('No se pudo actualizar la agenda desde la API');
    expect(text()).not.toContain('Error de red');
    expect(fixture.nativeElement.querySelector('.sync-panel .notice[role="status"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.sync-panel .error')).toBeNull();
  });

  it('un 504 sin pendientes no se presenta como error del servidor ni inventa cambios sin sincronizar', () => {
    http.expectOne(url).flush({}, { status: 504, statusText: 'Gateway Timeout' });
    fixture.detectChanges();
    expect(text()).toContain('Sincronización no disponible');
    expect(text()).toContain('No se pudo actualizar la agenda desde la API');
    expect(text()).not.toContain('Error del servidor');
    expect(text()).not.toContain('504');
    expect(text()).not.toContain('Cambios locales sin sincronizar');
    expect(fixture.nativeElement.querySelector('.sync-panel .notice[role="status"]')).not.toBeNull();
  });

  it('confirma el guardado en verde y separa los cambios sin sincronizar ante un 504', () => {
    http.expectOne(url).flush({ contacts: [] });
    component.openForm();
    component.fields = CONTACT;
    component.save();
    const id = component.store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({}, { status: 504, statusText: 'Gateway Timeout' });
    fixture.detectChanges();
    const success = fixture.nativeElement.querySelector('.feedback.success[role="status"]') as HTMLElement;
    expect(success.textContent?.trim()).toBe('Cambios locales guardados.');
    expect(text()).toContain('Los cambios locales todavía no están sincronizados');
    expect(text()).not.toContain('Consulta el estado');
    expect(text()).not.toContain('Error del servidor');
    expect(text()).not.toContain('504');
    expect(component.store.snapshot!.pending.length).toBe(1);
    expect(component.formOpen).toBeFalse();
  });

  it('mantiene la confirmación verde para altas, ediciones y eliminaciones offline', () => {
    http.expectOne(url).flush({ contacts: [] });
    onlineGetter.and.returnValue(false);
    window.dispatchEvent(new Event('offline'));
    component.openForm();
    component.fields = CONTACT;
    component.save();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.feedback.success')?.textContent).toContain('Cambios locales guardados.');
    const original = component.store.snapshot!.contacts[0];
    component.openForm(original);
    component.fields = { ...CONTACT, name: 'Editado' };
    component.save();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.feedback.success')?.textContent).toContain('Cambios locales guardados.');
    spyOn(window, 'confirm').and.returnValue(true);
    component.delete(component.store.snapshot!.contacts[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.feedback.success')?.textContent).toContain('Cambios locales guardados.');
    expect(component.store.snapshot!.contacts).toEqual([]);
    expect(component.store.snapshot!.pending.length).toBe(3);
    http.expectNone(() => true);
  });

  it('un fallo al eliminar se muestra como error, nunca como confirmación verde', () => {
    http.expectOne(url).flush({ contacts: [CONTACT] });
    spyOn(window, 'confirm').and.returnValue(true);
    memory.failWrite = true;
    component.delete(CONTACT);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.feedback.success')).toBeNull();
    expect(fixture.nativeElement.querySelector('.feedback.error[role="alert"]')?.textContent).toContain('El cambio no quedó guardado');
    expect(component.store.snapshot!.contacts).toEqual([CONTACT]);
    http.expectNone(() => true);
  });

  it('un timeout muestra cambios pendientes y no un error técnico', fakeAsync(() => {
    http.expectOne(url).flush({ contacts: [] });
    component.openForm();
    component.fields = CONTACT;
    component.save();
    const request = http.expectOne(`${url}/${component.store.snapshot!.contacts[0].id}`);
    tick(10000);
    fixture.detectChanges();
    expect(request.cancelled).toBeTrue();
    expect(text()).toContain('Los cambios locales todavía no están sincronizados');
    expect(fixture.nativeElement.querySelector('.sync-panel .error')).toBeNull();
  }));

  it('conserva los errores reales del servidor y de validación', () => {
    http.expectOne(url).flush({}, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sync-panel .error[role="alert"]')?.textContent).toContain('Error del servidor');
    component.openForm();
    component.fields = CONTACT;
    component.save();
    const id = component.store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({}, { status: 422, statusText: 'Invalid' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sync-panel .error[role="alert"]')?.textContent).toContain('Validación del servidor');
    expect(text()).toContain('Corregir operación rechazada');
  });

  it('aclara que el indicador pertenece al navegador y explica el reintento periódico', () => {
    http.expectOne(url).flush({ contacts: [] });
    fixture.detectChanges();
    expect(text()).toContain('Navegador con conexión aparente');
    expect(text()).toContain('no comprueba la API ni el servidor frontend');
    expect(text()).toContain('Reintento automático cada 5 minutos');
    expect(fixture.nativeElement.querySelector('.sync-notification')).toBeNull();
  });

  it('muestra y permite cerrar la notificación verde de sincronización confirmada', () => {
    http.expectOne(url).flush({ contacts: [] });
    component.openForm();
    component.fields = CONTACT;
    component.save();
    const contact = component.store.snapshot!.contacts[0];
    http.expectOne(`${url}/${contact.id}`).flush(contact);
    http.expectOne(url).flush({ contacts: [contact] });
    fixture.detectChanges();
    const notification = fixture.nativeElement.querySelector('.sync-notification.success[role="status"]') as HTMLElement;
    expect(notification.textContent).toContain('Cambios sincronizados con la API.');
    notification.querySelector('button')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sync-notification')).toBeNull();
  });

  it('no notifica éxito de sincronización si la API no respondió', () => {
    http.expectOne(url).flush({ contacts: [] });
    component.openForm();
    component.fields = CONTACT;
    component.save();
    const id = component.store.snapshot!.contacts[0].id;
    http.expectOne(`${url}/${id}`).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sync-notification')).toBeNull();
    expect(text()).toContain('Cambios locales guardados.');
    expect(text()).toContain('Los cambios locales todavía no están sincronizados');
  });

  it('solo solicita permiso de notificación al pulsar el botón de activación', fakeAsync(() => {
    http.expectOne(url).flush({ contacts: [] });
    fixture.detectChanges();
    expect(notificationsBrowser.requestPermission).not.toHaveBeenCalled();
    const button = fixture.nativeElement.querySelector('.notifications-enable') as HTMLButtonElement;
    expect(button.textContent).toContain('Activar notificaciones');
    button.click();
    expect(notificationsBrowser.requestPermission).toHaveBeenCalledTimes(1);
    flushMicrotasks();
    fixture.detectChanges();
    expect(text()).toContain('Permiso concedido');
    expect(fixture.nativeElement.querySelector('.notifications-enable')).toBeNull();
    expect(fixture.nativeElement.querySelector('.notifications-test')).not.toBeNull();
  }));

  it('explica el permiso bloqueado sin volver a solicitarlo', fakeAsync(() => {
    http.expectOne(url).flush({ contacts: [] });
    notificationsBrowser.nextPermission = 'denied';
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.notifications-enable') as HTMLButtonElement).click();
    flushMicrotasks();
    fixture.detectChanges();
    expect(text()).toContain('Notificaciones bloqueadas');
    expect(fixture.nativeElement.querySelector('.notifications-test')).toBeNull();
    (fixture.nativeElement.querySelector('.notifications-refresh') as HTMLButtonElement).click();
    expect(notificationsBrowser.requestPermission).toHaveBeenCalledTimes(1);
    notificationsBrowser.permission = 'granted';
    window.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(text()).toContain('Permiso concedido');
  }));

  it('explica las limitaciones de desarrollo, soporte y contexto seguro', () => {
    http.expectOne(url).flush({ contacts: [] });
    notificationsBrowser.workerEnabled = false;
    component.systemNotifications.refreshPermission();
    fixture.detectChanges();
    expect(text()).toContain('usa npm run serve:pwa');
    expect(fixture.nativeElement.querySelector('.notifications-enable')).toBeNull();
    notificationsBrowser.supported = false;
    component.systemNotifications.refreshPermission();
    fixture.detectChanges();
    expect(text()).toContain('Este navegador no admite');
    notificationsBrowser.secureContext = false;
    component.systemNotifications.refreshPermission();
    fixture.detectChanges();
    expect(text()).toContain('Se necesita HTTPS o localhost');
    expect(notificationsBrowser.requestPermission).not.toHaveBeenCalled();
  });

  it('el botón de prueba notifica sin cambiar contactos ni consultar la API', fakeAsync(() => {
    http.expectOne(url).flush({ contacts: [CONTACT] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.notifications-test')).toBeNull();
    notificationsBrowser.permission = 'granted';
    component.systemNotifications.refreshPermission();
    fixture.detectChanges();
    const before = component.store.snapshot;
    const writes = memory.writes;
    (fixture.nativeElement.querySelector('.notifications-test') as HTMLButtonElement).click();
    flushMicrotasks();
    fixture.detectChanges();
    expect(notificationsBrowser.registration.showNotification).toHaveBeenCalledTimes(1);
    expect(notificationsBrowser.registration.showNotification.calls.mostRecent().args[0]).toBe('Prueba de notificación');
    expect(text()).toContain('Notificación de prueba enviada al sistema.');
    expect(component.store.snapshot).toBe(before);
    expect(memory.writes).toBe(writes);
    expect(fixture.nativeElement.querySelector('.sync-notification')).toBeNull();
    http.expectNone(() => true);
  }));
});

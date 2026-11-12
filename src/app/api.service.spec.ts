import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TimeoutError } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { ApiService } from './api.service';
import { InvalidResponseError } from './contact';
import { CONTACT } from './testing/memory-storage';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;
  const url = 'http://test.invalid/api/contacts';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: API_BASE_URL, useValue: 'http://test.invalid/' },
    ] });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('acepta una lista vacía como respuesta válida', () => {
    api.getContacts().subscribe(contacts => expect(contacts).toEqual([]));
    http.expectOne(url).flush({ contacts: [] });
  });

  it('rechaza una lista mal formada o con ids repetidos', () => {
    for (const response of [[], {}, { contacts: [CONTACT, CONTACT] }, { contacts: [{ ...CONTACT, name: '' }] }]) {
      api.getContacts().subscribe({ next: () => fail('Debía rechazar la respuesta'), error: error => expect(error).toEqual(jasmine.any(InvalidResponseError)) });
      http.expectOne(url).flush(response);
    }
  });

  it('PUT envía los tres campos sin id y acepta 200 y 201', () => {
    for (const status of [200, 201]) {
      api.putContact(CONTACT).subscribe(contact => expect(contact).toEqual(CONTACT));
      const request = http.expectOne(`${url}/${CONTACT.id}`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ name: CONTACT.name, email: CONTACT.email, phone: CONTACT.phone });
      request.flush(CONTACT, { status, statusText: 'OK' });
    }
  });

  it('rechaza un reconocimiento PUT de otro contacto', () => {
    api.putContact(CONTACT).subscribe({ next: () => fail('ID inesperado'), error: error => expect(error).toEqual(jasmine.any(InvalidResponseError)) });
    http.expectOne(`${url}/${CONTACT.id}`).flush({ ...CONTACT, id: crypto.randomUUID() });
  });

  it('DELETE exige un reconocimiento 204', () => {
    api.deleteContact(CONTACT.id).subscribe(value => expect(value).toBeUndefined());
    const request = http.expectOne(`${url}/${CONTACT.id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    api.deleteContact(CONTACT.id).subscribe({ next: () => fail('200 no confirma el contrato'), error: error => expect(error).toEqual(jasmine.any(InvalidResponseError)) });
    http.expectOne(`${url}/${CONTACT.id}`).flush({});
  });

  it('cancela peticiones que exceden diez segundos', fakeAsync(() => {
    api.getContacts().subscribe({ next: () => fail('Sin respuesta'), error: error => expect(error).toEqual(jasmine.any(TimeoutError)) });
    const request = http.expectOne(url);
    tick(10000);
    expect(request.cancelled).toBeTrue();
  }));
});

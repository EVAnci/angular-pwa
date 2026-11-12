import { Inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, timeout } from 'rxjs';
import { API_BASE_URL, API_TIMEOUT_MS } from './api.config';
import { Contact, InvalidResponseError, parseContact, parseContacts } from './contact';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly contactsUrl: string;

  constructor(
    private readonly http: HttpClient,
    @Inject(API_BASE_URL) baseUrl: string,
    @Inject(API_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {
    this.contactsUrl = `${baseUrl.replace(/\/+$/, '')}/api/contacts`;
  }

  getContacts(): Observable<Contact[]> {
    return this.http.get<unknown>(this.contactsUrl).pipe(
      timeout(this.timeoutMs), map(parseContacts),
    );
  }

  putContact(contact: Contact): Observable<Contact> {
    const { name, email, phone } = contact;
    return this.http.put<unknown>(`${this.contactsUrl}/${contact.id}`, { name, email, phone }, {
      observe: 'response',
    }).pipe(timeout(this.timeoutMs), map(response => {
      if (response.status !== 200 && response.status !== 201) {
        throw new InvalidResponseError('La API no confirmó el guardado como se esperaba.');
      }
      return parseContact(response.body, contact.id);
    }));
  }

  deleteContact(id: string): Observable<void> {
    return this.http.delete(`${this.contactsUrl}/${id}`, { observe: 'response' }).pipe(
      timeout(this.timeoutMs), map(response => {
        if (response.status !== 204) {
          throw new InvalidResponseError('La API no confirmó la eliminación con un estado 204.');
        }
      }),
    );
  }
}

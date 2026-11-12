import { InjectionToken } from '@angular/core';

// Único lugar donde se configura el backend. Cambiarlo requiere recompilar.
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:8000',
});

export const API_TIMEOUT_MS = new InjectionToken<number>('API_TIMEOUT_MS', {
  providedIn: 'root',
  factory: () => 10000,
});

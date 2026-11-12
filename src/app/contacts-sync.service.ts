import { DestroyRef, Injectable, NgZone } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject, Observable, TimeoutError, catchError, concatMap, defer, finalize,
  fromEvent, interval, map, merge, of, tap, throwError,
} from 'rxjs';
import { ApiService } from './api.service';
import { InvalidResponseError } from './contact';
import { ContactsStoreService } from './contacts-store.service';
import { LocalStorageError } from './local-storage.service';
import { SystemNotificationsService } from './system-notifications.service';

export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export interface SyncIssue {
  readonly kind: 'network' | 'server' | 'validation' | 'response' | 'storage';
  readonly message: string;
}

export interface SyncStatus {
  readonly phase: 'local' | 'pending' | 'syncing' | 'synced' | 'error';
  readonly issue: SyncIssue | null;
  readonly lastSyncedAt: number | null;
}

@Injectable({ providedIn: 'root' })
export class ContactsSyncService {
  private readonly onlineSubject = new BehaviorSubject(navigator.onLine);
  private readonly statusSubject = new BehaviorSubject<SyncStatus>({
    phase: 'local', issue: null, lastSyncedAt: null,
  });
  private readonly notificationSubject = new BehaviorSubject<string | null>(null);
  readonly online$ = this.onlineSubject.asObservable();
  readonly status$ = this.statusSubject.asObservable();
  readonly notification$ = this.notificationSubject.asObservable();
  private running = false;

  constructor(
    private readonly store: ContactsStoreService,
    private readonly api: ApiService,
    private readonly destroyRef: DestroyRef,
    private readonly zone: NgZone,
    private readonly systemNotifications: SystemNotificationsService,
  ) {
    merge(fromEvent(window, 'online'), fromEvent(window, 'offline'))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.onlineSubject.next(navigator.onLine);
        if (navigator.onLine) this.synchronize();
      });
    this.store.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.dismissNotification();
      this.synchronize();
    });
    // Fuera de Angular para no impedir la estabilidad inicial y el registro del service worker.
    this.zone.runOutsideAngular(() => {
      interval(AUTO_SYNC_INTERVAL_MS).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        const state = this.store.snapshot;
        if (state?.pending.length && !state.rejected && this.onlineSubject.value && !this.running) {
          this.zone.run(() => this.synchronize());
        }
      });
    });
  }

  dismissNotification(): void {
    this.notificationSubject.next(null);
  }

  synchronize(): void {
    if (this.running) return;
    const state = this.store.snapshot;
    if (!state) return;
    if (state.rejected) {
      this.setStatus('error', {
        kind: state.rejected.status === null ? 'response' : state.rejected.status === 422 ? 'validation' : 'server',
        message: state.rejected.message,
      });
      return;
    }
    if (!this.onlineSubject.value) {
      this.setStatus(state.pending.length ? 'pending' : 'local');
      return;
    }
    this.running = true;
    this.dismissNotification();
    this.setStatus('syncing');
    let sentChanges = false;
    this.drainAndReconcile(() => sentChanges = true).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.running = false),
    ).subscribe({
      next: () => {
        this.statusSubject.next({ phase: 'synced', issue: null, lastSyncedAt: Date.now() });
        if (sentChanges) {
          this.notificationSubject.next('Cambios sincronizados con la API.');
          this.systemNotifications.notifySynced();
        }
      },
      error: error => this.setStatus('error', this.describeError(error)),
    });
  }

  private drainAndReconcile(onAcknowledged: () => void): Observable<void> {
    return defer(() => {
      const state = this.store.snapshot;
      if (!state) throw new LocalStorageError('No se pudo cargar el estado local.');
      const operation = state.pending[0];
      if (operation) {
        const request$ = operation.type === 'put'
          ? this.api.putContact(operation.contact).pipe(map(() => undefined))
          : this.api.deleteContact(operation.contactId);
        return request$.pipe(
          catchError(error => {
            if (this.isPermanent(error)) {
              this.store.reject({
                operationId: operation.operationId,
                status: error instanceof HttpErrorResponse ? error.status : null,
                message: this.describeError(error).message,
              });
            }
            return throwError(() => error);
          }),
          // No aplicar el contacto devuelto: podría haber ediciones locales más nuevas.
          tap(() => {
            this.store.acknowledge(operation.operationId);
            onAcknowledged();
          }),
          concatMap(() => this.drainAndReconcile(onAcknowledged)),
        );
      }
      const revision = this.store.revision;
      return this.api.getContacts().pipe(concatMap(contacts => {
        if (this.store.reconcile(contacts, revision)) return of(undefined);
        // Un cambio durante GET invalida la respuesta, no la edición.
        return this.drainAndReconcile(onAcknowledged);
      }));
    });
  }

  private isPermanent(error: unknown): boolean {
    return error instanceof InvalidResponseError || (error instanceof HttpErrorResponse
      && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429);
  }

  private setStatus(phase: SyncStatus['phase'], issue: SyncIssue | null = null): void {
    this.statusSubject.next({ ...this.statusSubject.value, phase, issue });
  }

  private describeError(error: unknown): SyncIssue {
    if (error instanceof LocalStorageError) return { kind: 'storage', message: error.message };
    if (error instanceof InvalidResponseError) return { kind: 'response', message: error.message };
    if (error instanceof TimeoutError || (error instanceof HttpErrorResponse
      && [0, 408, 502, 503, 504].includes(error.status))) {
      return {
        kind: 'network',
        message: this.store.snapshot?.pending.length
          ? 'Los cambios locales todavía no están sincronizados. Puedes reintentar cuando la API esté disponible.'
          : 'No se pudo actualizar la agenda desde la API. Puedes reintentar cuando esté disponible.',
      };
    }
    if (error instanceof HttpErrorResponse) {
      if (error.status === 422) {
        return { kind: 'validation', message: 'La API rechazó una operación (422). Corrige la operación pendiente o reintenta explícitamente tras revisar el servidor.' };
      }
      return { kind: 'server', message: `La API respondió con un error (${error.status}). No se descartaron cambios pendientes.` };
    }
    return { kind: 'server', message: 'Ocurrió un error inesperado al sincronizar. Los datos locales se conservan.' };
  }
}

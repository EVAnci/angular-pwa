import { Routes } from '@angular/router';
import { ContactsComponent } from './contacts/contacts.component';

export const routes: Routes = [
  { path: '', component: ContactsComponent },
  { path: '**', redirectTo: '' }
];

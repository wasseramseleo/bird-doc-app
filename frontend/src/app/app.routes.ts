import {Routes} from '@angular/router';
import {DataEntryFormComponent} from './data-entry-form/data-entry-form';
import {HomeComponent} from './home/home';
import {authGuard} from './core/guards/auth.guard';
import {guestGuard} from './core/guards/guest.guard';
import {orgAdminGuard} from './core/guards/org-admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {path: '', component: HomeComponent, canActivate: [authGuard], pathMatch: 'full'},
  {
    path: 'data-entries',
    loadComponent: () =>
      import('./data-entry-list/data-entry-list').then((m) => m.DataEntryListComponent),
    canActivate: [authGuard],
  },
  {
    // Issue #163: "today's session" — queued (nicht synchronisiert) and
    // today's already-synced captures for the active Projekt, visible and
    // reviewable offline.
    path: 'heute',
    loadComponent: () =>
      import('./today-session/today-session').then((m) => m.TodaySessionComponent),
    canActivate: [authGuard],
  },
  {path: 'data-entry', component: DataEntryFormComponent, canActivate: [authGuard]},
  {path: 'data-entry/:id', component: DataEntryFormComponent, canActivate: [authGuard]},
  {
    path: 'stationen',
    loadComponent: () => import('./stationen/stationen').then((m) => m.StationenComponent),
    canActivate: [authGuard, orgAdminGuard],
  },
  {path: '**', redirectTo: ''},
];

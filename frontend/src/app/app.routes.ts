import {Routes} from '@angular/router';
import {DataEntryFormComponent} from './data-entry-form/data-entry-form';
import {HomeComponent} from './home/home';
import {authGuard} from './core/guards/auth.guard';
import {guestGuard} from './core/guards/guest.guard';
import {orgAdminGuard} from './core/guards/org-admin.guard';
import {projectSelectedGuard} from './core/guards/project-selected.guard';
import {unsavedChangesGuard} from './core/guards/unsaved-changes.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  // ADR 0018 + issue #221: `/` is the current Projekt's dashboard. When no
  // Projekt is selected, projectSelectedGuard redirects to the dedicated picker.
  {
    path: '',
    component: HomeComponent,
    canActivate: [authGuard, projectSelectedGuard],
    pathMatch: 'full',
  },
  {
    // Issue #221: the dedicated project picker (pre-Visualisierung Home), listing
    // every Projekt visible to the user. Reached from the navbar "Alle Projekte …"
    // switcher item and from `/` when no Projekt is selected.
    path: 'projekte',
    loadComponent: () =>
      import('./project-picker/project-picker').then((m) => m.ProjectPickerComponent),
    canActivate: [authGuard],
  },
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
  // Issue #407 (ADR 0032): leaving a capture with unsaved input asks first —
  // there is no autosave, so a half-entered Wiederfang lives in the form and
  // nowhere else. This also closes the bare `n` shortcut, which navigated here
  // from anywhere and threw an in-progress form away unguarded.
  {
    path: 'data-entry',
    component: DataEntryFormComponent,
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
  },
  {
    path: 'data-entry/:id',
    component: DataEntryFormComponent,
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
  },
  {
    path: 'stationen',
    loadComponent: () => import('./stationen/stationen').then((m) => m.StationenComponent),
    canActivate: [authGuard, orgAdminGuard],
  },
  {
    path: 'beringer',
    loadComponent: () => import('./beringer/beringer').then((m) => m.BeringerComponent),
    canActivate: [authGuard, orgAdminGuard],
  },
  {
    // PRD #245, issue #251: the Org-Admin Artennorm editor. Admin-only, so it
    // pairs authGuard with orgAdminGuard exactly like /stationen and /beringer —
    // a non-Admin Mitglied is redirected home (the editor is hidden for them).
    path: 'artennormen',
    loadComponent: () => import('./artennormen/artennormen').then((m) => m.ArtennormenComponent),
    canActivate: [authGuard, orgAdminGuard],
  },
  {path: '**', redirectTo: ''},
];

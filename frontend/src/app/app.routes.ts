import {Routes} from '@angular/router';
import {DataEntryFormComponent} from './data-entry-form/data-entry-form';
import {HomeComponent} from './home/home';
import {authGuard} from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login').then((m) => m.LoginComponent),
  },
  {path: '', component: HomeComponent, canActivate: [authGuard], pathMatch: 'full'},
  {path: 'data-entry', component: DataEntryFormComponent, canActivate: [authGuard]},
  {path: '**', redirectTo: ''},
];

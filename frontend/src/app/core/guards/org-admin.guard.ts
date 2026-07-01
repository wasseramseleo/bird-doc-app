import {inject} from '@angular/core';
import {CanActivateFn, Router} from '@angular/router';
import {AuthService} from '../../service/auth.service';

// Station management is an Organisation-Admin power (ADR 0005). Pairs with
// authGuard on the /stationen route: authGuard handles "signed in?", this one
// handles "admin?", sending everyone else back to the home page.
export const orgAdminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.currentUser()?.rolle === 'admin') {
    return true;
  }

  return router.createUrlTree(['/']);
};

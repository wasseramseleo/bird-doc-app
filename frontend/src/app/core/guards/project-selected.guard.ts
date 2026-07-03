import {inject} from '@angular/core';
import {CanActivateFn, Router} from '@angular/router';
import {ProjectService} from '../../service/project.service';

// ADR 0018 + issue #221: `/` is the current Projekt's dashboard. When no Projekt
// is selected there is nothing to show, so send the user to the dedicated
// picker at `/projekte`. `currentProject()` rehydrates synchronously from
// storage, so a browser reload straight into `/` keeps landing on the dashboard.
export const projectSelectedGuard: CanActivateFn = () => {
  const projectService = inject(ProjectService);
  const router = inject(Router);

  if (projectService.currentProject()) {
    return true;
  }

  return router.createUrlTree(['/projekte']);
};

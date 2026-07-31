import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';
import {Router, RouterLink} from '@angular/router';

import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';

import {FailureBannerComponent} from '../shared/failure-banner/failure-banner';
import {LoadFailureComponent} from '../shared/load-failure/load-failure';
import {AppFailure, appFailureOf} from '../core/errors/app-failure';
import {ProjectService} from '../service/project.service';
import {ProjectActionsService} from '../service/project-actions.service';
import {AuthService} from '../service/auth.service';
import {Project} from '../models/project.model';

/**
 * Which of the four dead ends (or non-dead-ends) the empty picker is actually
 * looking at (issue #415). The picker cannot say anything true without knowing
 * both facts the server acts on: whether the account has a Beringer — Projekt
 * visibility is scoped to it — and its Rolle, which decides whether creating a
 * Projekt is even permitted.
 */
export type PickerEmptyCase =
  | 'no-beringer-admin'
  | 'no-beringer-mitglied'
  | 'no-projects-admin'
  | 'no-projects-mitglied';

/**
 * The pre-Visualisierung project picker, now at its own `/projekte` route
 * (issue #221). Lists every Projekt visible to the user and offers, per row,
 * open/select plus "Bearbeiten" and IWM-Export, and a page-level "Neues Projekt"
 * create action. Create/edit/export are delegated to {@link ProjectActionsService}
 * (the single source of truth); selecting a Projekt makes it current and lands on
 * its dashboard at `/` (ADR 0018).
 *
 * It is also the surface where a missing Beringer becomes legible (issue #415).
 * Accepting an Org-Einladung creates a Mitgliedschaft but no Beringer (ADR 0016),
 * and Projekt visibility is Beringer-scoped — so an invited account lands here,
 * on an empty list, through no fault of its own. The picker therefore mirrors the
 * two facts the server acts on (Beringer presence, Rolle) rather than assuming the
 * single cause it used to name: "Du bist noch keinem Projekt zugeordnet."
 */
@Component({
  selector: 'app-project-picker',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    FailureBannerComponent,
    LoadFailureComponent,
  ],
  templateUrl: './project-picker.html',
  styleUrl: './project-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectPickerComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  // protected, weil das Template den Schreib-Fehlschlag des Dienstes rendert
  // (#448): die Geste passiert hier, die Arbeit dort.
  protected readonly actions = inject(ProjectActionsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal<boolean>(true);
  /**
   * #446 (ADR 0037): ein gescheitertes Laden ersetzt den Picker an Ort und
   * Stelle. Vorher toastete es drei Sekunden und ließ den Leerzustand stehen —
   * der Bildschirm behauptete dann eine der vier Diagnosen aus #415 („noch
   * keinem Projekt zugeordnet", „dein Konto hat noch keinen Beringer"), obwohl
   * er in Wahrheit gar nichts wusste. Genau diese falsche Diagnose hat #415
   * beseitigt; sie darf nicht über einen Ladefehler zurückkommen.
   */
  readonly loadFailure = signal<AppFailure | null>(null);
  // Rendered from the shared ProjectService list so the picker and the navbar
  // switcher can never disagree about which Projekte exist.
  readonly projects = this.projectService.projects;

  /**
   * "Neues Projekt" is offered only to an account that can both create a Projekt
   * *and* see the result (issue #415). Admin alone is not enough: creating a
   * Projekt is Admin-only server-side, but Projekt visibility is scoped to the
   * creator's Beringer — so an Admin without one creates a Projekt that succeeds
   * (201) and is then immediately invisible to them, leaving the picker empty and
   * repeating the same advice. That invites another click, and silently pollutes
   * the Organisation with duplicate Projekte. Both halves are load-bearing.
   */
  readonly canCreateProject = computed(() => this.auth.isOrgAdmin() && this.auth.hasBeringer());

  /**
   * Which empty state to render. An account with no Beringer always lands here —
   * its Projekt list can never be non-empty — so the no-Beringer cases need no
   * non-empty counterpart. An unresolved Rolle reads as "not an Admin": the
   * honest advice for someone whose powers we cannot establish is the one that
   * asks an Admin.
   */
  readonly emptyCase = computed<PickerEmptyCase>(() => {
    const admin = this.auth.isOrgAdmin();
    if (!this.auth.hasBeringer()) {
      return admin ? 'no-beringer-admin' : 'no-beringer-mitglied';
    }
    return admin ? 'no-projects-admin' : 'no-projects-mitglied';
  });

  ngOnInit(): void {
    // The create/edit dialogs need the Organisationen and Beringer; the shared
    // ProjectActionsService owns loading them.
    this.actions.loadReferenceData();
    this.load();
  }

  // protected, weil „Erneut laden" aus dem In-Place-Fehlerzustand genau hierher
  // zurückkommt (#446). Die Referenzdaten der Dialoge bleiben davon unberührt:
  // erneut zu laden gilt dem Inhalt, der nicht kam.
  protected load(): void {
    this.loading.set(true);
    this.loadFailure.set(null);
    this.projectService.loadProjects().subscribe({
      next: () => this.loading.set(false),
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadFailure.set(appFailureOf(err));
      },
    });
  }

  selectProject(project: Project): void {
    this.projectService.setCurrent(project);
    // ADR 0018: selecting a Projekt lands on its dashboard (`/`), not the picker.
    this.router.navigateByUrl('/');
  }

  create(): void {
    this.actions.create();
  }

  edit(project: Project, event: MouseEvent): void {
    // Keep the per-row action from also selecting the Projekt.
    event.stopPropagation();
    this.actions.edit(project);
  }

  exportIwm(project: Project, event: MouseEvent): void {
    event.stopPropagation();
    this.actions.exportIwm(project);
  }
}

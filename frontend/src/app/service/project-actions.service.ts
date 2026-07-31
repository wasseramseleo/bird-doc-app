import {DestroyRef, Injectable, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {NavigationEnd, Router} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {filter} from 'rxjs/operators';

import {ApiService} from './api.service';
import {AuthService} from './auth.service';
import {AppFailure, Fehlerklasse, appFailureOf, localFailure} from '../core/errors/app-failure';
import {SchreibFehler} from '../core/errors/schreib-fehler';
import {ProjectService} from './project.service';
import {Project} from '../models/project.model';
import {Scientist} from '../models/scientist.model';
import {
  ProjectCreateDialogComponent,
  ProjectCreateDialogData,
  ProjectCreateDialogResult,
} from '../home/project-create-dialog/project-create-dialog';
import {
  ProjectEditDialogComponent,
  ProjectEditDialogData,
  ProjectEditDialogResult,
} from '../home/project-edit-dialog/project-edit-dialog';

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(header);
  if (quotedMatch) {
    return quotedMatch[1];
  }
  const bareMatch = /filename=([^;]+)/i.exec(header);
  return bareMatch ? bareMatch[1].trim() : null;
}

/**
 * Single source of truth for Projekt create / edit / IWM-Export (issue #221).
 * It owns the dialog → API → snackbar → {@link ProjectService} upsert flow so the
 * `/projekte` picker — and, in a follow-up slice, the Projekt dashboard — can
 * trigger these operations without duplicating the wiring. All user-facing
 * strings stay German.
 *
 * **Der Fehlschlag wohnt hier, die Oberfläche beim Bildschirm** (#448,
 * ADR 0037). Die Geste — „Neues Projekt", „Bearbeiten", „IWM-Export" — wird auf
 * dem Picker oder dem Projekt-Dashboard ausgelöst, ihre Arbeit aber hier getan.
 * Deshalb hält dieser Dienst den `schreibFehler`, und beide Bildschirme rendern
 * daraus dasselbe `<app-failure-banner>`: die Zurückweisung landet dort, wo
 * gedrückt wurde, und verfällt nicht. Die Snackbar behält genau eine Aufgabe —
 * zu bestätigen, dass etwas gelungen ist.
 *
 * **„Dort, wo gedrückt wurde" ist auch eine Grenze, nicht nur eine Adresse.**
 * Dieser Dienst lebt in der Wurzel und überlebt damit jeden Bildschirmwechsel —
 * der Fehlschlag darf das nicht. Ein abgelehntes „Neues Projekt" auf `/projekte`
 * stünde sonst gleich darauf über dem Dashboard eines fremden Projekts, und
 * „Erneut versuchen" schickte dort das aufgegebene Anlegen noch einmal los.
 * Deshalb zwei Regeln, und beide sind dieselbe: der Fehlschlag geht mit dem
 * Bildschirm. Eine abgeschlossene Navigation leert das Banner (`NavigationEnd`
 * im Konstruktor), und eine Antwort, die erst nach dem Wechsel eintrifft, wird
 * gar nicht erst gezeigt (`zeigeAufAusloesendemBildschirm`). Genau das meint
 * `SchreibFehler` mit „verschwindet mit ihm" — die Bildschirme haben es als Feld
 * gratis, dieser Dienst muss es aussprechen.
 */
@Injectable({providedIn: 'root'})
export class ProjectActionsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Reference data the create/edit dialogs need. Loaded on demand by a consumer
  // (the picker) via loadReferenceData(); kept here so the dialogs have a single
  // owner rather than each consumer re-fetching. The Organisation is NOT part of
  // it: both dialogs only ever display the one they already belong to, which
  // AuthService already holds (issue #389).
  private readonly scientists = signal<Scientist[]>([]);

  /** Die zurückgewiesene Schreibung, die der auslösende Bildschirm zeigt (#448). */
  readonly schreibFehler = new SchreibFehler();

  constructor() {
    // Der Bildschirm ist gewechselt: was auf dem vorigen zurückgewiesen wurde,
    // geht mit ihm (#448). Ohne das trüge der Wurzeldienst das Banner des
    // Pickers auf das Projekt-Dashboard hinüber — über ein Projekt, mit dem die
    // Geste nichts zu tun hatte, und mit einem „Erneut versuchen", das dort das
    // aufgegebene Anlegen erneut abschickte.
    this.router.events
      .pipe(
        filter((ereignis): ereignis is NavigationEnd => ereignis instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.schreibFehler.leeren());
  }

  /**
   * Den Fehlschlag zeigen — aber nur, wenn der Bildschirm, auf dem gedrückt
   * wurde, noch da ist.
   *
   * Die Navigation räumt bereits ab, was schon im Banner steht; das hier deckt
   * die andere Hälfte derselben Regel ab: eine Antwort, die **während** des
   * Wechsels unterwegs war und erst danach eintrifft. Sie gehört einem
   * Bildschirm, den niemand mehr ansieht — sie auf dem nächsten zu zeigen, wäre
   * dieselbe Verwechslung, nur eine Sekunde später.
   */
  private zeigeAufAusloesendemBildschirm(
    ausgeloestAuf: string,
    failure: AppFailure,
    erneut: () => void,
  ): void {
    if (this.router.url !== ausgeloestAuf) {
      return;
    }
    this.schreibFehler.zeige(failure, erneut);
  }

  loadReferenceData(): void {
    this.api.getScientists().subscribe({next: (res) => this.scientists.set(res.results)});
  }

  create(): void {
    // The new Projekt lands in the *active* Organisation, which the server sets
    // authoritatively — so the dialog shows it as plain text rather than offering
    // a choice, and the payload carries no organization_id at all (issue #389).
    this.schreibFehler.leeren();
    const organization = this.auth.currentUser()?.organization ?? null;
    if (organization === null) {
      // Keine aktive Organisation ist laut ADR 0037 Evidenz für *Freigeben
      // lassen* — der Ausweg ist eine Person, nicht ein erneuter Versuch. Ein
      // Transport steht nicht dahinter, also wählt die Klasse hier die
      // aufrufende Stelle.
      this.schreibFehler.zeige(
        localFailure(
          Fehlerklasse.FreigebenLassen,
          'Für dein Konto ist keine Organisation aktiv, in der ein Projekt entstehen könnte.',
        ),
        () => this.create(),
      );
      return;
    }
    const ref = this.dialog.open<
      ProjectCreateDialogComponent,
      ProjectCreateDialogData,
      ProjectCreateDialogResult
    >(ProjectCreateDialogComponent, {
      data: {
        organization,
        scientists: this.scientists(),
        currentBeringerHandle: this.auth.currentUser()?.handle ?? null,
      },
      width: '480px',
    });
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.postProject(result);
    });
  }

  private postProject(result: ProjectCreateDialogResult): void {
    this.schreibFehler.leeren();
    const ausgeloestAuf = this.router.url;
    this.api
      .createProject({
        title: result.title,
        description: result.description,
        scientist_ids: result.scientistIds,
        projekttyp: result.projekttyp,
        // Optionale Felder (ADR 0035): the dialog already inverted „angehakt =
        // sichtbar" into the opt-out list that gets stored.
        hidden_optional_fields: result.hiddenOptionalFields,
        default_station_id: result.defaultStationHandle || null,
        saison_start_month: result.saisonStartMonth,
        saison_end_month: result.saisonEndMonth,
        // Die Wochengrenze (ADR 0036): reist immer mit, weil sie sich nicht
        // abwählen lässt — ohne Änderung ist es der Montag-00:00-Default.
        wochengrenze_weekday: result.wochengrenzeWeekday,
        wochengrenze_time: result.wochengrenzeTime,
      })
      .subscribe({
        next: (project) => {
          this.snackBar.open(`Projekt "${project.title}" wurde erstellt.`, 'Schließen', {duration: 3000});
          this.projectService.upsertProject(project);
          // Creating a Projekt lands you on its dashboard (ADR 0018): make it
          // current and navigate to the home route.
          this.projectService.setCurrent(project);
          this.router.navigateByUrl('/');
        },
        error: (err: unknown) =>
          this.zeigeAufAusloesendemBildschirm(ausgeloestAuf, appFailureOf(err), () =>
            this.postProject(result),
          ),
      });
  }

  edit(project: Project): void {
    const ref = this.dialog.open<
      ProjectEditDialogComponent,
      ProjectEditDialogData,
      ProjectEditDialogResult
    >(ProjectEditDialogComponent, {
      data: {project, scientists: this.scientists()},
      width: '480px',
    });
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.patchProject(project, result);
    });
  }

  private patchProject(project: Project, result: ProjectEditDialogResult): void {
    this.schreibFehler.leeren();
    const ausgeloestAuf = this.router.url;
    this.api
      .updateProject(project.id, {
        title: result.title,
        description: result.description,
        scientist_ids: result.scientistIds,
        // Optionale Felder (ADR 0035): the stored opt-out list, already inverted
        // from the dialog's „angehakt = sichtbar" checkboxes.
        hidden_optional_fields: result.hiddenOptionalFields,
        projekttyp: result.projekttyp,
        default_station_id: result.defaultStationHandle || null,
        // The Saison window (ADR 0029): both null clears the season.
        saison_start_month: result.saisonStartMonth,
        saison_end_month: result.saisonEndMonth,
        // Die Wochengrenze (ADR 0036): nichts zu leeren — Wochentag und Uhrzeit
        // werden als Paar geschrieben.
        wochengrenze_weekday: result.wochengrenzeWeekday,
        wochengrenze_time: result.wochengrenzeTime,
      })
      .subscribe({
        next: (updated) => {
          this.snackBar.open(`Projekt "${updated.title}" wurde aktualisiert.`, 'Schließen', {duration: 3000});
          this.projectService.upsertProject(updated);
          if (this.projectService.currentProject()?.id === updated.id) {
            this.projectService.setCurrent(updated);
          }
        },
        error: (err: unknown) =>
          this.zeigeAufAusloesendemBildschirm(ausgeloestAuf, appFailureOf(err), () =>
            this.patchProject(project, result),
          ),
      });
  }

  exportIwm(project: Project): void {
    this.schreibFehler.leeren();
    const ausgeloestAuf = this.router.url;
    this.api.exportIwm(project.id).subscribe({
      next: (response) => {
        const blob = response.body;
        if (!blob) {
          // Eine 200er-Antwort ohne Körper: nichts, was das Mitglied tun
          // könnte, also *Unbekannt* — die Klasse, die nie die Eingabe
          // beschuldigt und „Fehler melden" anbietet (ADR 0037).
          this.zeigeAufAusloesendemBildschirm(
            ausgeloestAuf,
            localFailure(Fehlerklasse.Unbekannt, 'Der IWM-Export kam ohne Inhalt zurück.'),
            () => this.exportIwm(project),
          );
          return;
        }
        const filename =
          parseFilenameFromContentDisposition(response.headers.get('Content-Disposition')) ??
          `IWM_${project.title}.xlsx`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      },
      error: (err: unknown) =>
        this.zeigeAufAusloesendemBildschirm(ausgeloestAuf, appFailureOf(err), () =>
          this.exportIwm(project),
        ),
    });
  }
}

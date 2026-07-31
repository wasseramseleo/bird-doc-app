import {ChangeDetectionStrategy, Component, computed, inject, input, output} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {Router} from '@angular/router';
import {firstValueFrom} from 'rxjs';

import {AppFailure, FEHLERKLASSE_WORTE} from '../../core/errors/app-failure';
import {AppIconErrorDirective} from '../app-icons';
import {AppUpdateService} from '../../service/app-update.service';
import {AuthService} from '../../service/auth.service';
import {UnsavedChangesService} from '../../service/unsaved-changes.service';

/**
 * Die Oberfläche der **ausgelösten Schreibung** (ADR 0037): eine Speicherung,
 * die zurückgewiesen wurde, landet dort, wo die Geste stattfand — und **verfällt
 * nie**. Der Beringer hat beide Hände am Vogel und kann nicht binnen drei
 * Sekunden hinsehen; deshalb gibt es hier keine Snackbar, keinen Timer und kein
 * Selbst-Verschwinden. Das Banner geht, wenn der Fehlschlag behandelt ist.
 *
 * Verallgemeinert aus dem bestehenden `sync-error-banner` (#164): **dasselbe
 * Bauteil online wie beim Replay**, damit eine Zurückweisung gleich aussieht, ob
 * sie beim Speichern oder beim Synchronisieren entstanden ist. Nur die
 * Überschrift kennt den Moment — `titel` überschreibt sie; ohne Angabe kommt sie
 * aus der Fehlerklasse.
 *
 * Es trägt Titel, Grund, den Ausweg und die Abhilfe-Knöpfe. Welche Knöpfe das
 * sind, entscheidet allein die **Klasse**, nie ein Status: „Anmelden",
 * „Jetzt aktualisieren" und „Erneut versuchen" gehören zu je einer von ihnen.
 * Ein Code, den der Client nicht kennt, bekommt keinen eigenen Knopf (ADR 0038);
 * die ring-gebundenen Abhilfen (#444), „Fehler melden" (#449) und die
 * namentlich genannten Admins (#450) kommen in ihren eigenen Scheiben dazu.
 */
@Component({
  selector: 'app-failure-banner',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, AppIconErrorDirective],
  templateUrl: './failure-banner.html',
  styleUrls: ['./failure-banner.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FailureBannerComponent {
  private readonly router = inject(Router);
  private readonly appUpdate = inject(AppUpdateService);
  private readonly auth = inject(AuthService);
  private readonly unsavedChanges = inject(UnsavedChangesService);

  /** Der eingeordnete Fehlschlag — die Klasse bestimmt Worte und Knöpfe. */
  readonly failure = input.required<AppFailure>();

  /** Die Überschrift des Moments; ohne sie die der Klasse. */
  readonly titel = input<string | null>(null);

  /**
   * „Erneut versuchen": der einzige Ausweg, der je nach Moment etwas anderes
   * bedeutet (hier Speichern drücken, beim Laden neu laden) — also der einzige,
   * den das Banner nach oben meldet, statt ihn selbst zu tun.
   */
  readonly retry = output<void>();

  protected readonly worte = computed(() => FEHLERKLASSE_WORTE[this.failure().klasse]);
  protected readonly titelZeile = computed(() => this.titel() ?? this.worte().titel);
  protected readonly abhilfe = computed(() => this.failure().remedy);

  /**
   * „Anmelden" — zurück zur Anmeldung, mit dem Weg hierher im Gepäck.
   *
   * Beendet zuerst die Sitzung am Gerät. Das ist keine Dopplung des
   * `authInterceptor`: bei einem dauerhaften Schreibvorgang (#447, ADR 0039)
   * hält der seine 401-Arbeit bewusst zurück, damit der Fang noch unter seinem
   * Konto in die Outbox kommt — die Sitzung steht dann noch, und der
   * `guestGuard` würde das Mitglied von `/login` postwendend zurückwerfen.
   * Dieser Knopf **ist** die angenommene Aufforderung, also beendet er sie.
   * Wo der Interceptor sie längst beendet hat, ändert der Aufruf nichts.
   */
  protected onAnmelden(): void {
    this.auth.sessionExpired();
    const next = this.router.url && this.router.url !== '/login' ? this.router.url : '/';
    void this.router.navigate(['/login'], {queryParams: {next}});
  }

  /**
   * „Jetzt aktualisieren" — der bestehende Pfad aus ADR 0032: erst nachsehen,
   * ob es überhaupt eine neue Version gibt, dann fragen, dann übernehmen.
   *
   * Wartet keine Version, passiert **nichts**: ein Reload käme auf demselben
   * Bundle zurück, und mitten in einer Erfassung ist er Datenverlust. Genau
   * deshalb wird auch erst nach dem Verwerfen gefragt, wenn es etwas zu
   * übernehmen gibt.
   */
  protected async onAktualisieren(): Promise<void> {
    await this.appUpdate.checkForUpdate();
    if (!this.appUpdate.versionWaiting()) {
      return;
    }
    if (await firstValueFrom(this.unsavedChanges.confirmDiscard())) {
      await this.appUpdate.adopt();
    }
  }
}

import {formatDate} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatButtonModule} from '@angular/material/button';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {Router} from '@angular/router';
import {firstValueFrom} from 'rxjs';

import {AppFailure, FEHLERKLASSE_WORTE, Fehlerklasse} from '../../core/errors/app-failure';
import {fehlerMeldenAngeboten, fehlerberichtVorlage} from '../../core/errors/fehlerbericht';
import {kollidierenderErstfang} from '../../core/errors/ring-kollision';
import {AppIconErrorDirective} from '../app-icons';
import {
  FeedbackDialogComponent,
  FeedbackDialogData,
} from '../../feedback/feedback-dialog/feedback-dialog';
import {OrgAdmin} from '../../models/org-admin.model';
import {ApiService} from '../../service/api.service';
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
 * sind, entscheidet die **Klasse**: „Anmelden", „Jetzt aktualisieren" und
 * „Erneut versuchen" gehören zu je einer von ihnen. Daneben kann „Fehler melden"
 * stehen (#449) — die einzige Stelle, an der die Evidenz mitentscheidet, weil ein
 * 5xx dieselbe Klasse trägt wie ein Verbindungsabbruch und trotzdem ein Defekt
 * ist; die Regel steht in `fehlerMeldenAngeboten`, nicht hier.
 * Ein Code, den der Client nicht kennt, bekommt keinen eigenen Knopf (ADR 0038).
 *
 * **Eine Abhilfe füllt das Formular und speichert nie** (#444, ADR 0037): bei
 * einer bereits vergebenen Ringnummer nennt das Banner den kollidierenden
 * Erstfang und bietet drei Wege an — ihn öffnen, den Fang als Wiederfang
 * erfassen, die nächste freie Nummer übernehmen. Die beiden letzten meldet es
 * nach oben, statt sie selbst zu tun: nur das Formular kennt seine Felder.
 * Gedrückt wird Speichern danach vom Beringer selbst, weil „Als Wiederfang" die
 * wissenschaftliche Aussage des Datensatzes ändert.
 *
 * **Der Ausweg der Klasse *Freigeben lassen* ist kein Knopf, sondern eine
 * Person** (#450): dort liest das Banner die Admins der eigenen Organisation und
 * nennt sie beim Namen, weil „wende dich an eine:n Admin" in einer Organisation
 * mit zwanzig Mitgliedern ein Achselzucken ist (ADR 0037).
 */
@Component({
  selector: 'app-failure-banner',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatIconModule, AppIconErrorDirective],
  templateUrl: './failure-banner.html',
  styleUrls: ['./failure-banner.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FailureBannerComponent {
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly appUpdate = inject(AppUpdateService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly unsavedChanges = inject(UnsavedChangesService);
  private readonly dialog = inject(MatDialog);
  private readonly locale = inject(LOCALE_ID);

  /** Der eingeordnete Fehlschlag — die Klasse bestimmt Worte und Knöpfe. */
  readonly failure = input.required<AppFailure>();

  /** Die Überschrift des Moments; ohne sie die der Klasse. */
  readonly titel = input<string | null>(null);

  /**
   * Ob das Formular nach der nächsten freien Ringnummer gefragt hat und keine
   * bekam (#444) — dann steht dort ein Satz statt eines Knopfes, der wortlos
   * nichts täte.
   */
  readonly keineFreieNummer = input(false);

  /**
   * „Erneut versuchen": der einzige Ausweg, der je nach Moment etwas anderes
   * bedeutet (hier Speichern drücken, beim Laden neu laden) — also der einzige,
   * den das Banner nach oben meldet, statt ihn selbst zu tun.
   */
  readonly retry = output<void>();

  /**
   * „Als Wiederfang erfassen" (#444) — der Ringstatus, sonst nichts. Das Banner
   * meldet den Wunsch nach oben; setzen kann ihn nur, wer die Felder hält.
   */
  readonly alsWiederfang = output<void>();

  /** „Nächste freie Nummer übernehmen" (#444) — dasselbe, für die Ringnummer. */
  readonly freieNummer = output<void>();

  protected readonly worte = computed(() => FEHLERKLASSE_WORTE[this.failure().klasse]);
  protected readonly titelZeile = computed(() => this.titel() ?? this.worte().titel);
  protected readonly abhilfe = computed(() => this.failure().remedy);

  /**
   * Der kollidierende Erstfang (#444) — oder `null`, wo keiner zu nennen ist.
   *
   * `null` ist die Degradierung: ein älteres Backend, ein Bundle mitten in der
   * Auslieferung, ein von einem älteren Bundle geflaggter Eintrag. Dann bleibt
   * es beim Satz allein, und es gibt **keine** der drei Abhilfen — dieselbe
   * Regel wie bei einem unbekannten Code (ADR 0038). Ohne den Rivalen ist die
   * Frage „derselbe Vogel oder ein alter Tippfehler?" gar nicht zu beantworten;
   * „Als Wiederfang erfassen" blind anzubieten hieße, eine wissenschaftliche
   * Aussage ohne jeden Beleg zum Fingerdruck zu machen.
   */
  protected readonly erstfang = computed(() => kollidierenderErstfang(this.failure()));

  /**
   * Der Rivale in einer Zeile: Datum · Uhrzeit · Art · Beringer-Kürzel. Was
   * fehlt, fällt weg — erfunden wird nichts (ein gelöschter Beringer, eine Art
   * ohne deutschen Namen).
   */
  protected readonly erstfangZeile = computed(() => {
    const rivale = this.erstfang();
    if (!rivale) {
      return null;
    }
    const angaben = [
      rivale.date_time ? formatDate(rivale.date_time, 'dd.MM.yyyy', this.locale) : null,
      rivale.date_time ? formatDate(rivale.date_time, 'HH:mm', this.locale) : null,
      rivale.species,
      rivale.staff,
    ].filter((angabe): angabe is string => !!angabe);
    return `Belegt durch: ${angaben.join(' · ')}`;
  });

  /** Die Admins der eigenen Organisation — leer, solange keine gelesen wurden. */
  private readonly admins = signal<readonly OrgAdmin[]>([]);

  /**
   * Der Ausweg **mit Namen** — oder `null`, wo niemand zu nennen ist.
   *
   * `null` ist die Degradierung, und sie ist der wichtigere Fall: ohne Netz, bei
   * einem gescheiterten Lesevorgang, in einer Organisation ohne nennbaren Admin.
   * Dann bleibt es beim Ausweg-Satz der Klasse — nie ein leeres „frag: ", nie ein
   * zweiter Fehler über dem ersten.
   *
   * **Die Klasse steht auch hier vor der Liste**, nicht nur vor dem Lesen: das
   * Banner überlebt den Wechsel von einem Fehlschlag zum nächsten (`showFailure()`
   * kommt aus fünf Botengängen, und nur das Speichern leert es vorher), und eine
   * Antwort, die erst danach eintrifft, gehört einer Klasse, die nicht mehr da
   * ist. Ohne diese Prüfung schriebe sie Namen auf ein *Erneut versuchen* — und
   * verdrängte dort dessen eigenen Ausweg-Satz. Ein Mitglied zu einer Kollegin zu
   * schicken, wo niemand etwas freizugeben hat, ist genau der Fehlgriff, gegen
   * den die Disambiguierung des 403 (#441) angetreten ist.
   */
  protected readonly adminSatz = computed(() => {
    if (this.failure().klasse !== Fehlerklasse.FreigebenLassen) {
      return null;
    }
    const namen = this.admins()
      .map(adminName)
      .filter((name) => name.length > 0);
    return namen.length > 0 ? `Freigeben kann das ${aufzaehlung(namen)}.` : null;
  });

  constructor() {
    effect(() => {
      // Gelesen wird nur, wo eine Person überhaupt etwas ausrichten kann. Eine
      // CSRF-Ablehnung kommt deshalb nie hier an: sie ist *Erneut versuchen*
      // (#441) — jemanden ihretwegen zu behelligen wäre der Fehlgriff, den die
      // Disambiguierung des 403 ausgeräumt hat.
      if (this.failure().klasse !== Fehlerklasse.FreigebenLassen) {
        this.admins.set([]);
        return;
      }
      this.api
        .getOrgAdmins()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (seite) => this.admins.set(seite.results),
          // Scheitert das Lesen selbst, wird daraus **kein** eigener Fehlschlag:
          // ein Fehler über den Fehler ist das schlechteste erreichbare Ergebnis
          // (ADR 0038). Das Banner nennt dann eben niemanden.
          error: () => this.admins.set([]),
        });
    });
  }

  /**
   * Ob „Fehler melden" danebensteht (#449). Eigene Bedingung und kein Zweig des
   * `abhilfe`-Schalters: bei einem 5xx steht es **neben** „Erneut versuchen",
   * denn beides ist wahr — noch einmal drücken kann helfen, und wissen wollen
   * wir davon trotzdem.
   */
  protected readonly meldenAngeboten = computed(() => fehlerMeldenAngeboten(this.failure()));

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
   * „Erstfang öffnen" (#444) — liegt der Fehler drüben, wird er drüben
   * berichtigt.
   *
   * Die **gewöhnliche** Navigation zu einem Fang, genau die, die auch „Letzte
   * Fänge" und „Heute" benutzen. Damit gelten die Verwerfen-Regeln aus #407
   * unverändert: der `unsavedChangesGuard` hängt an der Route und fragt, bevor
   * eine angefangene Erfassung verloren geht. Hier wird ausdrücklich **keine**
   * Ausnahme erfunden — weder ein eigenes Fragen (das die Frage doppelt
   * stellte) noch ein Vorbeigehen am Wächter (das den Eintrag still fallen
   * ließe).
   *
   * Der Umweg über die leere Erfassungsmaske ist genau dafür da, dass beides
   * gilt: steht schon ein Fang offen (`/data-entry/:id` — so kommt ein
   * zurückgewiesener eingereihter Eintrag daher, #445), dann ist das Ziel für
   * den Router **dieselbe** Route mit einer anderen Id. Er verwendet das
   * Bauteil dann wieder, lädt den Eintrag nicht neu und lässt den Wächter gar
   * nicht erst laufen — der Knopf täte dort wortlos nichts. Der Zwischenschritt
   * ist das Verlassen, das die Route sonst verschluckt: dort fragt der Wächter,
   * und was er ablehnt, wird auch nicht geöffnet. In der History steht er
   * nicht (`skipLocationChange`).
   */
  protected async onErstfangOeffnen(): Promise<void> {
    const rivale = this.erstfang();
    if (!rivale) {
      return;
    }
    if (this.router.url.startsWith('/data-entry/')) {
      const verlassen = await this.router.navigateByUrl('/data-entry', {
        skipLocationChange: true,
      });
      if (!verlassen) {
        return;
      }
    }
    void this.router.navigate(['/data-entry', rivale.id]);
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

  /**
   * „Fehler melden" — der **bestehende** Feedback-Dialog (#81), vorbefüllt.
   *
   * Ein zweiter Dialog wird nicht gebaut, und `feedback_view` bleibt
   * unangetastet: das Feld ist Freitext, die Vorbefüllung ist bloß Text. Was
   * nur hier bekannt ist, reicht das Banner an die Vorlage weiter — der
   * Bildschirm, auf dem es passierte, die Uhr, und ob dieses Gerät die aktuelle
   * Version läuft.
   */
  protected onFehlerMelden(): void {
    const data: FeedbackDialogData = {
      prefill: fehlerberichtVorlage(this.failure(), {
        bildschirm: this.router.url || null,
        zeitpunkt: new Date(),
        versionVeraltet: this.appUpdate.versionStale(),
      }),
    };
    this.dialog.open(FeedbackDialogComponent, {width: '32rem', autoFocus: 'dialog', data});
  }
}

/**
 * Wie ein Admin im Banner heißt: „Alice Auer (ALC)", sonst das eine, was da ist.
 *
 * Beides kann fehlen, und nichts wird erfunden — ein Konto, das (noch) kein
 * Beringer ist, hat kein Kürzel, ein Konto ohne hinterlegten Namen keinen Namen.
 * Wer weder zu benennen noch abzukürzen ist, bekommt eine leere Zeichenkette und
 * fällt damit aus der Aufzählung: eine Klammer um nichts wäre schlechter als
 * seine Abwesenheit.
 */
function adminName({name, handle}: OrgAdmin): string {
  const voll = (name ?? '').trim();
  const kuerzel = (handle ?? '').trim();
  if (voll && kuerzel) {
    return `${voll} (${kuerzel})`;
  }
  return voll || kuerzel;
}

/** „A", „A oder B", „A, B oder C" — deutsch aufgezählt, nicht kommagetrennt. */
function aufzaehlung(namen: readonly string[]): string {
  if (namen.length === 1) {
    return namen[0];
  }
  return `${namen.slice(0, -1).join(', ')} oder ${namen[namen.length - 1]}`;
}

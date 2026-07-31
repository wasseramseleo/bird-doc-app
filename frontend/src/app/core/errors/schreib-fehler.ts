import {Signal, signal} from '@angular/core';

import {AppFailure} from './app-failure';

/**
 * Der zurückgewiesene Schreibvorgang **eines Bildschirms** (#448, ADR 0037) —
 * das, was `<app-failure-banner>` dort anzeigt, und das, was „Erneut versuchen"
 * dort bedeutet.
 *
 * Zwei Dinge gehören zusammen und wurden bis hierher pro Bildschirm neu
 * nebeneinandergelegt: der eingeordnete Fehlschlag und die Geste, die ihn
 * ausgelöst hat. Das Banner kennt die zweite bewusst nicht — es meldet nur, dass
 * gedrückt wurde (`retry`), weil nur der Bildschirm weiß, welcher Botengang
 * gescheitert war: ein Anlegen, ein Archivieren, ein Löschen. Diese Klasse ist
 * genau dieses Paar, einmal statt sechsmal.
 *
 * **Kein Dienst und kein Signal-Speicher**, sondern ein Feld auf dem Bauteil:
 * ein Fehlschlag gehört dem Bildschirm, auf dem er passierte, und verschwindet
 * mit ihm. Auf einem Bauteil ist das gratis — es wird zerstört, und sein Feld
 * geht mit.
 *
 * **Zwei Wurzeldienste halten trotzdem einen**, weil dort die Geste selbst in
 * einem Dienst wohnt: `ProjectActionsService` (Projekt-Anlage, -Bearbeitung,
 * IWM-Export) und `DataEntryRefreshService` (das gescheiterte „Rückgängig" über
 * der Liste). Beide leben länger als jeder Bildschirm, also müssen sie die
 * Grenze **aussprechen**, die ein Bauteil geschenkt bekommt: der eine leert bei
 * jeder abgeschlossenen Navigation und zeigt eine verspätete Antwort gar nicht
 * mehr, der andere leert bei jedem Laden der Liste. Ein hier gehaltener
 * Fehlschlag, den niemand abräumt, taucht sonst über einem fremden Bildschirm
 * wieder auf — samt einem „Erneut versuchen", das dort die falsche Schreibung
 * erneut abschickt.
 *
 * **Eine neue Schreibung leert das Banner** (`leeren()` zu Beginn), damit nie die
 * Antwort auf einen vorigen Versuch über einem laufenden stehen bleibt. Das ist
 * dieselbe Reihenfolge, die `data-entry-form` seit #443 fährt.
 */
export class SchreibFehler {
  private readonly _failure = signal<AppFailure | null>(null);
  private erneuterVersuch: (() => void) | null = null;

  /** Der Fehlschlag, der gerade im Banner steht — `null`, wenn keiner ansteht. */
  readonly failure: Signal<AppFailure | null> = this._failure.asReadonly();

  /**
   * Einen zurückgewiesenen Schreibvorgang zeigen. `erneut` ist, was „Erneut
   * versuchen" in *diesem* Moment heißt — derselbe Botengang noch einmal, nie
   * ein Neuladen und nie ein Weiterspringen.
   */
  zeige(failure: AppFailure, erneut: () => void): void {
    this._failure.set(failure);
    this.erneuterVersuch = erneut;
  }

  /** Zu Beginn jeder Schreibung: das Banner gehört dem laufenden Versuch. */
  leeren(): void {
    this._failure.set(null);
    this.erneuterVersuch = null;
  }

  /** Der Ausweg „Erneut versuchen", so wie ihn dieser Fehlschlag gemeint hat. */
  erneut(): void {
    this.erneuterVersuch?.();
  }
}

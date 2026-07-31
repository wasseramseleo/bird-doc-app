import {HttpErrorResponse} from '@angular/common/http';

import {AppFailure, Fehlerklasse} from './app-failure';

/**
 * „Fehler melden" (#449, ADR 0037): der eine Ausweg der Klasse *Unbekannt*.
 *
 * Ein unerkannter Fehlschlag beschuldigt nie die Eingabe — er sagt, dass es an
 * uns liegt, und bietet das Einzige an, das hilft: uns davon zu erzählen. Damit
 * der Betreiber den Bericht **ohne Rückfrage** einordnen kann, reisen die
 * technischen Angaben von selbst mit; das Mitglied tippt kein einziges Detail
 * ab.
 *
 * Wie die Einordnung selbst eine **reine Funktion** (Vorbild `app-failure.ts`):
 * das Bauteil reicht seinen eingeordneten Fehlschlag und die Umstände herein und
 * bekommt den fertigen Text.
 */

/**
 * Ob dieser Fehlschlag „Fehler melden" anbietet.
 *
 * Zwei Fälle, und nur diese zwei: die Klasse *Unbekannt* — dort gibt es
 * definitionsgemäß nichts, was das Mitglied selbst tun könnte — und ein **5xx**,
 * bei dem der Server sich verschluckt hat und nicht die Eingabe.
 *
 * Alles, was das Mitglied selbst beheben kann, bietet es **nicht** an:
 * *Korrigieren*, *Neu anmelden*, *Freigeben lassen*, *App aktualisieren* — und
 * auch *Erneut versuchen*, solange kein 5xx dahintersteht. Ein Verbindungsabbruch
 * und eine Drosselung tragen dieselbe Klasse wie ein 5xx, sind aber kein Defekt:
 * würde dort gemeldet, sammelte der Betreiber Nicht-Bugs und begrübe darunter die
 * echten. Deshalb entscheidet hier ausnahmsweise die Klasse **und** die Evidenz.
 */
export function fehlerMeldenAngeboten(failure: AppFailure): boolean {
  return failure.klasse === Fehlerklasse.Unbekannt || (failure.status ?? 0) >= 500;
}

/**
 * Was nur das Bauteil weiß: wo das Mitglied stand, wann es passierte, und ob
 * dieses Gerät überhaupt die aktuelle Version läuft.
 *
 * Herausgereicht statt hier injiziert, damit die Vorlage eine reine Funktion
 * bleibt — ein Test setzt einen festen Zeitpunkt, statt die Uhr zu stellen.
 */
export interface FehlerberichtUmstaende {
  /** Der Bildschirm, auf dem es passierte — `null`, wo keiner zu nennen ist. */
  readonly bildschirm: string | null;
  /** Wann es passierte. */
  readonly zeitpunkt: Date;
  /** Läuft dieses Gerät auf einer veralteten Version (ADR 0032)? */
  readonly versionVeraltet: boolean;
}

/** Die Überschrift des technischen Blocks — er soll erkennbar nicht vom Mitglied sein. */
const KOPFZEILE = 'Technische Angaben (bitte stehen lassen):';

/**
 * Der leere Raum über dem Block, in den der Cursor gesetzt wird: das Mitglied
 * schreibt **zuerst** seine eigenen Worte, die Angaben reisen darunter mit.
 */
const PLATZ_FUER_EIGENE_WORTE = '\n\n';

/**
 * Der vorbefüllte Text des Feedback-Dialogs zu einem Fehlschlag (User Story 22
 * und 23): Endpunkt, Status, Code, Zeitpunkt, Bildschirm und Version.
 *
 * **Eine fehlende Angabe fällt weg.** Nicht jeder Fehlschlag hat einen Code
 * (ein von Hand gebauter `Response` durchläuft keinen Exception-Handler), nicht
 * jeder hat einen Transport hinter sich, und nicht jeder Moment hat einen
 * Bildschirm zu nennen. Eine Zeile „Code: undefined" wäre schlimmer als keine:
 * sie sieht aus wie eine Angabe und ist keine.
 *
 * **Der Zeitpunkt reist als ISO 8601 in UTC** — die eine Form, die sich ohne
 * Rückfrage mit einem Server-Log zusammenlegen lässt. Er steht im technischen
 * Block, nicht in einem Satz an das Mitglied.
 *
 * **Die Version ist die, die diese App von sich weiß**: die SPA trägt keine
 * Build-Nummer (die Bilder laufen unter `:latest`, und `PAYLOAD_SCHEMA_VERSION`
 * ist ausdrücklich eine Payload-Vertrags- und **keine** Build-Version). Was das
 * Gerät wirklich über seine Version weiß, ist die vierte Klausel der
 * Offline-Bereitschaft: läuft es die aktuelle oder eine veraltete (ADR 0032)?
 * Genau das steht hier — und genau das ist die Angabe, die einen Fehlerbericht
 * ohne Rückfrage einordnet.
 */
export function fehlerberichtVorlage(
  failure: AppFailure,
  umstaende: FehlerberichtUmstaende,
): string {
  const angaben: ReadonlyArray<readonly [string, string | number | null]> = [
    ['Endpunkt', endpunktVon(failure)],
    ['Status', failure.status],
    ['Code', failure.code],
    ['Zeitpunkt', umstaende.zeitpunkt.toISOString()],
    ['Bildschirm', umstaende.bildschirm],
    ['Version', umstaende.versionVeraltet ? 'veraltet' : 'aktuell'],
  ];

  const zeilen = angaben
    .filter(([, wert]) => wert !== null && wert !== '')
    .map(([bezeichnung, wert]) => `${bezeichnung}: ${wert}`);

  return `${PLATZ_FUER_EIGENE_WORTE}${KOPFZEILE}\n${zeilen.join('\n')}\n`;
}

/**
 * Der Endpunkt, an dem es scheiterte — `null`, wo gar kein Transport
 * dahinterstand (ein lokaler Lesefehler hat keinen).
 */
function endpunktVon(failure: AppFailure): string | null {
  return failure.original instanceof HttpErrorResponse ? failure.original.url : null;
}

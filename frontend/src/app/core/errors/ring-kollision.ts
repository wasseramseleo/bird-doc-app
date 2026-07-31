import {AppFailure} from './app-failure';

/**
 * Die bereits vergebene Ringnummer und der Erstfang, der sie hält (#444,
 * ADR 0038).
 *
 * Das ist die Zurückweisung, mit der PRD #438 anfing, und sie stellt dem
 * Beringer genau eine Frage: **ist das derselbe Vogel, oder hat vorige Woche
 * jemand eine Nummer vertippt?** Beantworten kann er sie nur, wenn er den
 * kollidierenden Erstfang sieht — deshalb reist er als `context.rival` mit
 * (#442), und deshalb liest ihn diese Datei aus dem eingeordneten Fehlschlag
 * heraus.
 *
 * Wie die Einordnung selbst eine **reine Funktion** (Vorbild `app-failure.ts`,
 * `fehlerbericht.ts`): das Banner reicht seinen Fehlschlag herein und bekommt
 * den Rivalen oder `null`. Damit gilt sie unverändert für beide Momente — eine
 * soeben abgelehnte Speicherung und einen Tage später wieder geöffneten,
 * zurückgewiesenen Eintrag (#445), dessen Umschlag aus IndexedDB kommt.
 */

/**
 * Der Code, an dem die drei Abhilfen dieses Falls hängen — nicht der Satz.
 * Ein veröffentlichter Code ist Vertrag (ADR 0038); ein Textvergleich bräche
 * still bei jeder Textkorrektur, ohne dass ein Test anschlüge.
 */
export const RING_ALREADY_FIRST_CAUGHT = 'ring_already_first_caught';

/**
 * Der Erstfang, der die Nummer hält: die Id, um ihn zu öffnen, und Zeitpunkt,
 * Art und Beringer-Kürzel, um ihn wiederzuerkennen.
 *
 * Alles außer der Id darf fehlen und wird dann **nicht erfunden** — ein
 * gelöschter Beringer (`GELÖSCHT`) und eine Art ohne deutschen Namen sind im
 * Backend ausdrücklich vorgesehene Fälle.
 */
export interface KollidierenderErstfang {
  /** Die Id des Erstfangs — ohne sie gäbe es nichts zu öffnen. */
  readonly id: string;
  /** Sein Zeitpunkt, so wie ihn die API überall sonst auch schreibt. */
  readonly date_time: string | null;
  /** Die Art, unter der er erfasst wurde. */
  readonly species: string | null;
  /** Das Kürzel des Beringers, der ihn erfasst hat. */
  readonly staff: string | null;
}

/**
 * Der kollidierende Erstfang dieses Fehlschlags — oder `null`, wo keiner zu
 * nennen ist.
 *
 * `null` ist der wichtigere Rückgabewert, denn er ist die **Degradierung**: ein
 * älteres Backend, das den Kontext noch nicht mitschickt, ein Bundle mitten in
 * der Auslieferung, ein von einem älteren Bundle geflaggter Eintrag ohne
 * Umschlag. Dann bleibt es beim Satz allein — dieselbe Regel wie bei einem Code,
 * den dieser Client nicht kennt (ADR 0038). Nie ein halbes Angebot, nie ein
 * Knopf, der ins Leere führt.
 */
export function kollidierenderErstfang(failure: AppFailure): KollidierenderErstfang | null {
  if (failure.code !== RING_ALREADY_FIRST_CAUGHT) {
    return null;
  }
  const rival = failure.context?.['rival'];
  if (!rival || typeof rival !== 'object') {
    return null;
  }
  const felder = rival as Record<string, unknown>;
  const id = angabe(felder['id']);
  if (!id) {
    return null;
  }
  return {
    id,
    date_time: angabe(felder['date_time']),
    species: angabe(felder['species']),
    staff: angabe(felder['staff']),
  };
}

/** Eine Angabe des Servers, oder `null` — eine leere ist keine. */
function angabe(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() ? wert.trim() : null;
}

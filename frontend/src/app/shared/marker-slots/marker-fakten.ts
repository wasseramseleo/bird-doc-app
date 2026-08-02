/**
 * #480: **was die Marker-Spalte über einen Fang liest** — genau fünf Angaben,
 * nur lesend, und nichts darüber hinaus.
 *
 * Der Typ ist absichtlich schmal. `MarkerSlotsComponent` verlangte bis hierher
 * einen vollständigen `DataEntry`, und daran hing „Heute": dessen nicht
 * synchronisierter Abschnitt zeigt keine Server-Datensätze, sondern eine flache
 * Projektion aus dem Outbox-Eintrag. Ein `DataEntry` erfüllt `MarkerFakten`
 * **strukturell** — die Aufrufstellen in „Letzte Fänge" und der
 * Wiederfang-Historie reichen weiterhin ihren Datensatz herein, ohne Adapter
 * dazwischen (der Beweis dafür steht in `marker-slots.spec.ts`, weil ein
 * `setInput` nicht typgeprüft ist).
 *
 * **Nicht** der Weg dorthin: aus einer Warteschlangen-Zeile einen synthetischen
 * `DataEntry` bauen. Dessen Verweise auf Art, Ring, Station und Beringer:in sind
 * nicht nullbar, eine Warteschlangen-Zeile kann sie nicht auflösen, und das
 * Ergebnis wäre ein gefälschter Datensatz statt eines Adapters.
 *
 * Die Feldnamen sind die des Datensatzes — dieser Typ ist sein Ausschnitt, keine
 * zweite Sprache für dieselben Merkmale (dieselbe Linie wie `FangLesemodell`).
 */
export interface MarkerFakten {
  readonly has_brood_patch: boolean;
  readonly has_cpl_plus: boolean;
  readonly comment: string | null;
  readonly is_dead_recovery: boolean;
  readonly is_non_standard: boolean;
}

/**
 * Die fünf Angaben aus dem **Schreib-Payload** eines noch nicht
 * synchronisierten Fangs — reines Durchreichen.
 *
 * Sie stehen dort alle wörtlich: der Schreib-Serializer übernimmt den gesamten
 * Formularwert (`DataEntryFormComponent.transformFromForm`), und die Fangmarker
 * werden auf Lese- **und** Schreibseite serialisiert (ADR 0026), damit sie die
 * Offline-Warteschlange überhaupt überstehen. Es wird hier also nichts
 * abgeleitet und nichts gegen das Offline-Bundle aufgelöst — anders als bei Art,
 * Station und Beringer:in, die ein Nachschlagen brauchen.
 *
 * Der Payload ist ungetypt (Formularwerte), deshalb die ausdrückliche Prüfung
 * auf `true` und auf eine nicht leere Zeichenkette: ein abgeschaltetes
 * Kontrollkästchen hinterlässt `null`, ein geleertes Bemerkungsfeld `''`, und
 * beides heißt „nicht gesetzt" und nicht „unbekannt".
 */
export function markerFaktenAusPayload(payload: Record<string, unknown>): MarkerFakten {
  const bemerkung = payload['comment'];
  return {
    has_brood_patch: payload['has_brood_patch'] === true,
    has_cpl_plus: payload['has_cpl_plus'] === true,
    comment: typeof bemerkung === 'string' && bemerkung !== '' ? bemerkung : null,
    is_dead_recovery: payload['is_dead_recovery'] === true,
    is_non_standard: payload['is_non_standard'] === true,
  };
}

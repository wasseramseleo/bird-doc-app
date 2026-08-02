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
 * Die fünf Angaben liest „Heute" auch **nicht selbst** aus dem Outbox-Payload:
 * `FangLesemodell` liest ihn ohnehin schon für Art, Ring, Ringstatus und
 * Beringer:in derselben Zeile und erfüllt diesen Typ dadurch ebenfalls
 * strukturell. Eine zweite Lesung desselben Payloads daneben wäre eine zweite
 * Wahrheit über denselben Fang — und die Zeile widerspräche dem Dialog, den sie
 * öffnet.
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

import {
  AgeClass,
  BirdStatus,
  DataEntry,
  Direction,
  FatClass,
  HandWingMoult,
  MuscleClass,
  Parasit,
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
} from '../../models/data-entry.model';
import {Central} from '../../models/central.model';
import {OfflineBundle} from '../../models/offline-bundle.model';
import {OutboxEntry} from '../../models/outbox-entry.model';
import {resolveQueuedEntryDisplay} from '../../core/offline/queued-entry-display';
import {MarkerFakten} from '../marker-slots/marker-fakten';

/**
 * #495 (PRD #491): die Wendung für eine Referenz, die **dieses Gerät** nicht
 * auflösen kann — und ausdrücklich **nicht** der Gedankenstrich.
 *
 * Art, Station und Beringer:in sind Pflichtangaben eines Fangs. Derselbe
 * Gedankenstrich, den der Dialog für „Tarsus nicht gemessen" benutzt, liest sich
 * bei ihnen als „nicht erfasst" und ließe die Beringer:in an ihrer eigenen
 * Erfassung zweifeln. Vorbild daneben: die Zentrale verweigert den
 * Gedankenstrich bewusst und stellt stattdessen ihren EURING-Code hin
 * (`queued-entry-display.ts`).
 *
 * Der Wortlaut folgt dem, was die App schon sagt („auf diesem Gerät gesichert",
 * „auf diesem Gerät" in der lokalen Ring-Historie) — kein Anglizismus, keine
 * Entwicklersprache, in Österreich wie in Deutschland unauffällig.
 */
export const NICHT_AUF_DIESEM_GERAET_BEKANNT = 'auf diesem Gerät nicht bekannt';

/**
 * #495 (PRD #491): was der **Detail-Dialog** von einem Fang liest — mit
 * **nullbaren** Referenzen, weil ein noch nicht synchronisierter Fang keine
 * anderen haben kann: er trägt flache Ids und wird best effort gegen das
 * zwischengespeicherte Offline-Bundle aufgelöst.
 *
 * `DataEntry` wird dafür **nicht** aufgeweicht. Die Referenzen des
 * Server-Datensatzes nullbar zu machen, um einen Bildschirm zu bedienen, der
 * kein Server-Datensatz ist, würde jeden Leser eines Fangs zu Null-Behandlung
 * zwingen — für eine Nullbarkeit, die es dort gar nicht gibt. Also bekommt der
 * Dialog ein eigenes Lesemodell, und der Datensatz behält seine Zusagen.
 *
 * Die Feldnamen sind die des Datensatzes: dieses Modell ist seine
 * **Anzeigefläche**, keine zweite Sprache für dieselben Merkmale.
 *
 * #480: der Dialog ist nicht sein einziger Leser. Die Zeile in „Heute" liest
 * daraus schon Art, Ring, Ringstatus und Beringer:in — und seit #480 auch ihre
 * Marker-Spalte, die dafür nur die {@link MarkerFakten} sieht. Der Payload wird
 * damit **einmal** gelesen: die Zeile und der Dialog, den sie öffnet, können
 * über denselben Fang nichts Verschiedenes sagen.
 *
 * `null` heißt hier zweierlei, und der Dialog hält die beiden auseinander:
 * bei einer **Referenz** „dieses Gerät kennt sie nicht"
 * ({@link NICHT_AUF_DIESEM_GERAET_BEKANNT}), bei einem **optionalen Feld**
 * schlicht „nicht erfasst" (der Gedankenstrich).
 */
export interface FangLesemodell {
  /** Art — Pflichtangabe; `null` heißt „auf diesem Gerät nicht bekannt". */
  readonly species: {readonly common_name_de: string; readonly scientific_name: string} | null;
  /**
   * Ring — **ohne jedes Nachschlagen**: Größe und Nummer liegen auch bei einem
   * nicht synchronisierten Fang flach vor. `null` bei einem Fang ohne Ring.
   */
  readonly ring: {readonly size: string; readonly number: string} | null;
  /** Die Zentrale des Rings; `null`, wo keine gespeichert ist (ADR 0019). */
  readonly central: Central | null;
  /** Station — Pflichtangabe; `null` heißt „auf diesem Gerät nicht bekannt". */
  readonly ringing_station: {readonly name: string} | null;
  /** Beringer:in — Pflichtangabe; `null` heißt „auf diesem Gerät nicht bekannt". */
  readonly staff: {readonly full_name: string; readonly handle: string} | null;
  /** Abwesend bei einem Ring vernichtet — weder Erstfang noch Wiederfang (#469). */
  readonly bird_status: BirdStatus | null;
  readonly date_time: string;
  readonly net_location: number | null;
  readonly net_height: number | null;
  readonly net_direction: Direction | null;
  readonly age_class: AgeClass | null;
  readonly sex: Sex | null;
  readonly small_feather_int: SmallFeatherIntMoult | null;
  readonly small_feather_app: SmallFeatherAppMoult | null;
  readonly hand_wing: HandWingMoult | null;
  readonly tarsus: number | null;
  readonly feather_span: number | null;
  readonly wing_span: number | null;
  readonly weight_gram: number | null;
  readonly notch_f2: number | null;
  readonly inner_foot: number | null;
  readonly fat_deposit: FatClass | null;
  readonly muscle_class: MuscleClass | null;
  readonly parasites: readonly Parasit[];
  readonly has_hunger_stripes: boolean;
  readonly has_brood_patch: boolean;
  readonly has_cpl_plus: boolean;
  readonly comment: string | null;
  /**
   * Die beiden Fangmarker (ADR 0026). Sie kamen mit #480 dazu, weil dieses
   * Modell nicht nur der Dialog liest: die Zeile in „Heute" liest daraus schon
   * Art, Ring, Ringstatus und Beringer:in, und seit #480 auch ihre
   * Marker-Spalte. Mit ihnen erfüllt `FangLesemodell` die `MarkerFakten`
   * **strukturell** — sonst müsste derselbe Payload ein zweites Mal gelesen
   * werden, und die zwei Lesungen liefen lautlos auseinander.
   */
  readonly is_dead_recovery: boolean;
  readonly is_non_standard: boolean;
}

/**
 * Aus einem **Fang-Datensatz** — er löst immer auf, seine Referenzen stehen
 * nested daran. Rein und ohne Umgebung prüfbar.
 *
 * Der Ring wird trotz seiner nicht nullbaren Zusage defensiv gelesen: die
 * Kopfzeile des Dialogs griff bisher als Einzige ungeschützt darauf zu, während
 * die Zentrale zwei Abschnitte tiefer längst optional zugreift — ein Fang ohne
 * Ring zerlegte damit den Dialog, statt lesbar zu bleiben.
 */
export function lesemodellAusFang(fang: DataEntry): FangLesemodell {
  const ring = fang.ring as DataEntry['ring'] | null | undefined;
  return {
    species: fang.species ?? null,
    ring: ring ? {size: ring.size, number: ring.number} : null,
    central: ring?.central ?? null,
    ringing_station: fang.ringing_station ?? null,
    staff: fang.staff ?? null,
    bird_status: fang.bird_status ?? null,
    date_time: fang.date_time,
    net_location: fang.net_location,
    net_height: fang.net_height,
    net_direction: fang.net_direction,
    age_class: fang.age_class ?? null,
    sex: fang.sex ?? null,
    small_feather_int: fang.small_feather_int,
    small_feather_app: fang.small_feather_app,
    hand_wing: fang.hand_wing,
    tarsus: fang.tarsus,
    feather_span: fang.feather_span,
    wing_span: fang.wing_span,
    weight_gram: fang.weight_gram,
    notch_f2: fang.notch_f2,
    inner_foot: fang.inner_foot,
    fat_deposit: fang.fat_deposit,
    muscle_class: fang.muscle_class,
    parasites: fang.parasites ?? [],
    has_hunger_stripes: fang.has_hunger_stripes,
    has_brood_patch: fang.has_brood_patch,
    has_cpl_plus: fang.has_cpl_plus,
    comment: fang.comment,
    is_dead_recovery: fang.is_dead_recovery,
    is_non_standard: fang.is_non_standard,
  };
}

/**
 * Aus einem **noch nicht synchronisierten** Eintrag plus dem
 * zwischengespeicherten Offline-Bundle — best effort, mit `null`, wo das Bundle
 * die Referenz nicht (mehr) führt.
 *
 * Aufgelöst wird mit derselben Funktion, die die Erfassungsmaske und die Zeile
 * in „Heute" schon benutzen (`resolveQueuedEntryDisplay`): eine zweite Auflösung
 * daneben wäre eine zweite Wahrheit darüber, was dieses Gerät weiß.
 *
 * Der Payload ist der wörtliche Schreib-Payload (`transformFromForm`), also
 * ungetypt: seine Werte kommen aus Formularfeldern und werden hier auf das
 * gebracht, was der Dialog zeigt — die Zahlenmaske etwa hinterlässt eine rohe
 * Zeichenkette (#341).
 */
export function lesemodellAusEintrag(
  eintrag: OutboxEntry,
  bundle: OfflineBundle | null,
): FangLesemodell {
  const payload = eintrag.payload;
  const display = resolveQueuedEntryDisplay(payload, bundle);
  const size = text(payload['ring_size']);
  const number = text(payload['ring_number']);
  return {
    species: display.species,
    // Ringgröße und Ringnummer liegen flach im Payload — die Kopfzeile ist für
    // einen nicht synchronisierten Fang immer erzeugbar, Bundle hin oder her.
    ring: size && number ? {size, number} : null,
    central: display.central,
    ringing_station: display.ringingStation,
    staff: display.staff,
    bird_status: text(payload['bird_status']) as BirdStatus | null,
    // Ein Payload ohne Zeitpunkt ist kein Fang ohne Zeitpunkt: die Uhrzeit der
    // Einreihung steht daneben und ist die ehrlichere Antwort als nichts.
    date_time: text(payload['date_time']) ?? eintrag.queuedAt,
    net_location: zahl(payload['net_location']),
    net_height: zahl(payload['net_height']),
    net_direction: text(payload['net_direction']) as Direction | null,
    age_class: zahl(payload['age_class']) as AgeClass | null,
    sex: zahl(payload['sex']) as Sex | null,
    small_feather_int: zahl(payload['small_feather_int']) as SmallFeatherIntMoult | null,
    small_feather_app: text(payload['small_feather_app']) as SmallFeatherAppMoult | null,
    hand_wing: zahl(payload['hand_wing']) as HandWingMoult | null,
    tarsus: zahl(payload['tarsus']),
    feather_span: zahl(payload['feather_span']),
    wing_span: zahl(payload['wing_span']),
    weight_gram: zahl(payload['weight_gram']),
    notch_f2: zahl(payload['notch_f2']),
    inner_foot: zahl(payload['inner_foot']),
    fat_deposit: zahl(payload['fat_deposit']) as FatClass | null,
    muscle_class: zahl(payload['muscle_class']) as MuscleClass | null,
    parasites: Array.isArray(payload['parasites']) ? (payload['parasites'] as Parasit[]) : [],
    has_hunger_stripes: payload['has_hunger_stripes'] === true,
    has_brood_patch: payload['has_brood_patch'] === true,
    has_cpl_plus: payload['has_cpl_plus'] === true,
    comment: text(payload['comment']),
    // #480: die beiden Fangmarker reisen auf Lese- **und** Schreibseite mit
    // (ADR 0026) — sie stehen also wörtlich im Payload und brauchen so wenig
    // ein Nachschlagen wie Ringgröße und Ringnummer.
    is_dead_recovery: payload['is_dead_recovery'] === true,
    is_non_standard: payload['is_non_standard'] === true,
  };
}

/** Eine nicht leere Zeichenkette, sonst `null`. */
function text(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * Eine Zahl, sonst `null` — die Zahlenmaske hinterlässt `'19.5'` und ein
 * geleertes Feld `''` oder `null` (#341). Die 0 ist ein Wert (Fettvorrat 0),
 * kein leeres Feld.
 */
function zahl(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const wert = Number(raw);
  return Number.isFinite(wert) ? wert : null;
}

import {
  NICHT_AUF_DIESEM_GERAET_BEKANNT,
  lesemodellAusEintrag,
  lesemodellAusFang,
} from './fang-lesemodell';
import {
  AgeClass,
  BirdStatus,
  DataEntry,
  Direction,
  HandWingMoult,
  MuscleClass,
  Parasit,
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
} from '../../models/data-entry.model';
import {MarkerFakten} from '../marker-slots/marker-fakten';
import {OfflineBundle, OfflineIdentity} from '../../models/offline-bundle.model';
import {OutboxEntry} from '../../models/outbox-entry.model';
import {RingSize} from '../../models/ring.model';

/**
 * #495 (PRD #491): die zwei reinen Funktionen, die aus einem Fang das
 * **Lesemodell** des Detail-Dialogs machen — eine aus dem Server-Datensatz (löst
 * immer auf), eine aus einem noch nicht synchronisierten Eintrag plus dem
 * zwischengespeicherten Offline-Bundle (best effort).
 *
 * Geprüft **ohne TestBed, ohne Dialog, ohne Router** — dieselbe Bauart wie die
 * bestehende Auflösung der Warteschlangen-Anzeige, die Fehler-Einordnung und die
 * Ring-Kollision, die aus demselben Grund reine Funktionen sind.
 */
describe('das Lesemodell des Detail-Dialogs (#495)', () => {
  const KOHLMEISE = {
    id: 's1',
    common_name_de: 'Kohlmeise',
    common_name_en: 'Great Tit',
    scientific_name: 'Parus major',
    family_name: '',
    order_name: '',
    ring_size: RingSize.V,
    special_kind: '' as const,
    usage_count: 3,
  };
  const STATION = {handle: 'STAMT', name: 'Linz, Botanischer Garten'};
  const BERINGERIN = {id: 'sci-1', handle: 'FRE', full_name: 'Filip Reiter'};
  const IDENTITY: OfflineIdentity = {
    username: 'fre',
    handle: 'FRE',
    organization: null,
    rolle: 'mitglied',
  };

  function bundle(overrides: Partial<OfflineBundle> = {}): OfflineBundle {
    return {
      identity: IDENTITY,
      species: [KOHLMEISE],
      ringing_stations: [STATION],
      scientists: [BERINGERIN],
      projects: [],
      centrals: [],
      last_consumed_ring_numbers: [],
      ...overrides,
    };
  }

  /**
   * Ein **vollständig** vermessener Fang: jedes Merkmal, das der Dialog zeigt,
   * trägt hier einen Wert, der sich vom Leerwert unterscheidet. Ein Feld, das
   * die Fixture leer lässt, kann die Projektion straflos fallen lassen — ein
   * fest verdrahtetes `null` sähe genauso aus wie die Weitergabe. Was leer sein
   * darf, prüft die Fixture mit ausdrücklichem `overrides`.
   */
  function fang(overrides: Partial<DataEntry> = {}): DataEntry {
    return {
      id: 'server-1',
      species: KOHLMEISE,
      ring: {id: 'r1', number: '901234', size: RingSize.S},
      staff: BERINGERIN,
      ringing_station: STATION,
      project: null,
      net_location: 3,
      net_height: 2,
      net_direction: Direction.Left,
      feather_span: 55,
      wing_span: 78,
      tarsus: 19.5,
      notch_f2: 3,
      inner_foot: 9,
      weight_gram: 17.5,
      bird_status: BirdStatus.ReCatch,
      fat_deposit: 0,
      muscle_class: MuscleClass.Two,
      age_class: AgeClass.ThisYear,
      sex: Sex.Female,
      small_feather_int: SmallFeatherIntMoult.Some,
      small_feather_app: SmallFeatherAppMoult.Mixed,
      hand_wing: HandWingMoult.AtLeastOne,
      date_time: '2026-07-02T09:00:00Z',
      created: '2026-07-02T09:00:00Z',
      updated: '2026-07-02T09:00:00Z',
      comment: 'Ringablesung',
      parasites: [Parasit.Tick],
      has_hunger_stripes: true,
      has_brood_patch: true,
      has_cpl_plus: true,
      is_dead_recovery: false,
      is_non_standard: false,
      ...overrides,
    } as unknown as DataEntry;
  }

  function eintrag(payload: Record<string, unknown> = {}): OutboxEntry {
    return {
      id: 'outbox-uuid-1',
      accountKey: 'fre',
      queuedAt: '2026-07-02T09:05:00.000Z',
      payload: {
        species_id: 's1',
        ringing_station_id: 'STAMT',
        staff_id: 'sci-1',
        date_time: '2026-07-02T09:00',
        bird_status: BirdStatus.FirstCatch,
        ring_size: 'V',
        ring_number: '0043',
        idempotency_key: 'outbox-uuid-1',
        project_id: 'p1',
        ...payload,
      },
    };
  }

  describe('aus einem Fang-Datensatz', () => {
    it('löst Art, Station und Beringer:in immer auf — sie stehen am Datensatz', () => {
      const lesemodell = lesemodellAusFang(fang());

      expect(lesemodell.species?.common_name_de).toBe('Kohlmeise');
      expect(lesemodell.species?.scientific_name).toBe('Parus major');
      expect(lesemodell.ringing_station?.name).toBe('Linz, Botanischer Garten');
      expect(lesemodell.staff?.full_name).toBe('Filip Reiter');
      expect(lesemodell.staff?.handle).toBe('FRE');
    });

    it('trägt Ringgröße und Ringnummer', () => {
      const lesemodell = lesemodellAusFang(fang());

      expect(lesemodell.ring).toEqual({size: RingSize.S, number: '901234'});
    });

    it('nimmt jedes Merkmal mit, das der Dialog zeigt', () => {
      const lesemodell = lesemodellAusFang(fang());

      expect(lesemodell.bird_status).toBe(BirdStatus.ReCatch);
      expect(lesemodell.date_time).toBe('2026-07-02T09:00:00Z');
      expect(lesemodell.net_location).toBe(3);
      expect(lesemodell.net_height).toBe(2);
      expect(lesemodell.net_direction).toBe(Direction.Left);
      expect(lesemodell.age_class).toBe(AgeClass.ThisYear);
      expect(lesemodell.sex).toBe(Sex.Female);
      expect(lesemodell.small_feather_int).toBe(SmallFeatherIntMoult.Some);
      expect(lesemodell.small_feather_app).toBe(SmallFeatherAppMoult.Mixed);
      expect(lesemodell.hand_wing).toBe(HandWingMoult.AtLeastOne);
      expect(lesemodell.tarsus).toBe(19.5);
      expect(lesemodell.feather_span).toBe(55);
      expect(lesemodell.wing_span).toBe(78);
      expect(lesemodell.weight_gram).toBe(17.5);
      expect(lesemodell.notch_f2).toBe(3);
      expect(lesemodell.inner_foot).toBe(9);
      expect(lesemodell.fat_deposit).toBe(0);
      expect(lesemodell.muscle_class).toBe(MuscleClass.Two);
      expect(lesemodell.parasites).toEqual([Parasit.Tick]);
      expect(lesemodell.has_hunger_stripes).toBeTrue();
      expect(lesemodell.has_brood_patch).toBeTrue();
      expect(lesemodell.has_cpl_plus).toBeTrue();
      expect(lesemodell.comment).toBe('Ringablesung');
    });

    /**
     * Die Gegenprobe zur Zeile darüber: ein gesetztes Kennzeichen weiterzugeben
     * ist erst dann bewiesen, wenn ein **nicht** gesetztes auch nicht gesetzt
     * ankommt — sonst wäre ein fest verdrahtetes `true` so unsichtbar wie ein
     * fest verdrahtetes `false`. Dasselbe für ein nicht gemessenes Feld: der
     * Dialog macht daraus den Gedankenstrich, und der muss verdient sein.
     */
    it('lässt ein nicht gemessenes Feld leer und ein nicht gesetztes Kennzeichen ungesetzt', () => {
      const lesemodell = lesemodellAusFang(
        fang({
          small_feather_int: null,
          small_feather_app: null,
          hand_wing: null,
          tarsus: null,
          feather_span: null,
          wing_span: null,
          weight_gram: null,
          notch_f2: null,
          inner_foot: null,
          net_location: null,
          net_height: null,
          net_direction: null,
          fat_deposit: null,
          muscle_class: null,
          parasites: [],
          comment: null,
          has_hunger_stripes: false,
          has_brood_patch: false,
          has_cpl_plus: false,
        }),
      );

      expect(lesemodell.small_feather_int).toBeNull();
      expect(lesemodell.small_feather_app).toBeNull();
      expect(lesemodell.hand_wing).toBeNull();
      expect(lesemodell.tarsus).toBeNull();
      expect(lesemodell.feather_span).toBeNull();
      expect(lesemodell.wing_span).toBeNull();
      expect(lesemodell.weight_gram).toBeNull();
      expect(lesemodell.notch_f2).toBeNull();
      expect(lesemodell.inner_foot).toBeNull();
      expect(lesemodell.net_location).toBeNull();
      expect(lesemodell.net_height).toBeNull();
      expect(lesemodell.net_direction).toBeNull();
      expect(lesemodell.fat_deposit).toBeNull();
      expect(lesemodell.muscle_class).toBeNull();
      expect(lesemodell.parasites).toEqual([]);
      expect(lesemodell.comment).toBeNull();
      expect(lesemodell.has_hunger_stripes).toBeFalse();
      expect(lesemodell.has_brood_patch).toBeFalse();
      expect(lesemodell.has_cpl_plus).toBeFalse();
    });

    it('holt die Zentrale vom Ring, und liefert `null`, wo keine gespeichert ist', () => {
      const auw = {id: 'c-auw', scheme_code: 'AUW', name: 'Österreichische Vogelwarte', country: 'AT'};

      expect(lesemodellAusFang(fang({ring: {id: 'r1', number: '9', size: RingSize.S, central: auw}}))
        .central).toEqual(auw);
      expect(lesemodellAusFang(fang()).central).toBeNull();
    });

    // Die Kopfzeile las Größe und Nummer bisher ungeschützt, während die
    // Zentrale zwei Abschnitte tiefer defensiv zugreift.
    it('erzeugt auch ohne Ring ein gültiges Lesemodell', () => {
      const lesemodell = lesemodellAusFang(fang({ring: undefined as never}));

      expect(lesemodell.ring).toBeNull();
      expect(lesemodell.central).toBeNull();
      expect(lesemodell.species?.common_name_de).toBe('Kohlmeise');
    });

    /**
     * Der **Server-Datensatz wird nicht aufgeweicht**: seine Referenzen nullbar
     * zu machen, um einen Bildschirm zu bedienen, der kein Server-Datensatz ist,
     * würde jeden Leser eines Fangs zu Null-Behandlung zwingen. Die Nullbarkeit
     * gehört dem Lesemodell, nicht dem Datensatz — geprüft vom Übersetzer, weil
     * niemand sonst es merkt.
     */
    it('lässt `DataEntry` seine nicht nullbaren Referenzen', () => {
      const datensatz = fang();

      // @ts-expect-error — die Art eines Fang-Datensatzes ist nicht nullbar.
      datensatz.species = null;
      // @ts-expect-error — die Station eines Fang-Datensatzes ist nicht nullbar.
      datensatz.ringing_station = null;
      // @ts-expect-error — die Beringer:in eines Fang-Datensatzes ist nicht nullbar.
      datensatz.staff = null;
      // @ts-expect-error — der Ring eines Fang-Datensatzes ist nicht nullbar.
      datensatz.ring = null;

      expect(lesemodellAusFang(fang()).species).not.toBeNull();
    });
  });

  describe('aus einem nicht synchronisierten Eintrag', () => {
    it('löst eine auflösbare Referenz mit ihrem Namen auf', () => {
      const lesemodell = lesemodellAusEintrag(eintrag(), bundle());

      expect(lesemodell.species?.common_name_de).toBe('Kohlmeise');
      expect(lesemodell.ringing_station?.name).toBe('Linz, Botanischer Garten');
      expect(lesemodell.staff?.full_name).toBe('Filip Reiter');
    });

    /**
     * Art, Station und Beringer:in sind **Pflichtangaben** eines Fangs. Der
     * Gedankenstrich, den der Dialog für „Tarsus nicht gemessen" benutzt, hieße
     * hier „nicht erfasst" und ließe die Beringer:in an ihrer eigenen Erfassung
     * zweifeln — die Wendung dafür entscheidet der Dialog, nicht diese Funktion:
     * sie sagt `null` und damit „konnte ich nicht nachschlagen".
     */
    it('liefert `null` für eine Referenz, die das Bundle nicht führt', () => {
      const lesemodell = lesemodellAusEintrag(eintrag(), bundle({species: [], scientists: []}));

      expect(lesemodell.species).toBeNull();
      expect(lesemodell.staff).toBeNull();
      expect(lesemodell.ringing_station?.name).toBe('Linz, Botanischer Garten');
    });

    it('liefert `null` für jede Referenz, wenn es gar kein Bundle gibt', () => {
      const lesemodell = lesemodellAusEintrag(eintrag(), null);

      expect(lesemodell.species).toBeNull();
      expect(lesemodell.ringing_station).toBeNull();
      expect(lesemodell.staff).toBeNull();
    });

    // Ringgröße und Ringnummer liegen flach im Outbox-Payload: die Kopfzeile des
    // Dialogs ist für einen nicht synchronisierten Fang **immer** erzeugbar.
    it('trägt Ringgröße und Ringnummer ohne jedes Nachschlagen im Bundle', () => {
      const lesemodell = lesemodellAusEintrag(eintrag(), null);

      expect(lesemodell.ring).toEqual({size: 'V', number: '0043'});
    });

    it('erzeugt auch ohne Ring ein gültiges Lesemodell', () => {
      const lesemodell = lesemodellAusEintrag(
        eintrag({ring_size: null, ring_number: null}),
        bundle(),
      );

      expect(lesemodell.ring).toBeNull();
      expect(lesemodell.species?.common_name_de).toBe('Kohlmeise');
    });

    it('unterscheidet ein leeres optionales Feld von einer nicht auflösbaren Referenz', () => {
      const lesemodell = lesemodellAusEintrag(eintrag({tarsus: null}), null);

      // Beides ist `null` — was daraus für Augen und Screenreader wird, trennt
      // der Dialog: der Gedankenstrich für das nicht gemessene Feld, die Wendung
      // für die Referenz, die dieses Gerät nicht kennt.
      expect(lesemodell.tarsus).toBeNull();
      expect(lesemodell.species).toBeNull();
      expect(NICHT_AUF_DIESEM_GERAET_BEKANNT).toBe('auf diesem Gerät nicht bekannt');
      expect(NICHT_AUF_DIESEM_GERAET_BEKANNT).not.toBe('—');
    });

    it('nimmt jedes Merkmal mit, das der Dialog zeigt', () => {
      const lesemodell = lesemodellAusEintrag(
        eintrag({
          bird_status: BirdStatus.ReCatch,
          net_location: 3,
          net_height: 2,
          net_direction: Direction.Right,
          age_class: AgeClass.NotThisYear,
          sex: Sex.Male,
          small_feather_int: 1,
          small_feather_app: 'M',
          hand_wing: 2,
          // Die Maske hinterlässt eine rohe Zeichenkette (#341) — der Dialog
          // zeigt trotzdem eine Zahl.
          tarsus: '19.5',
          feather_span: '55',
          wing_span: '78',
          weight_gram: '17.5',
          notch_f2: '3',
          inner_foot: '9',
          fat_deposit: 0,
          muscle_class: 2,
          parasites: [Parasit.RedMites, Parasit.Tick],
          has_hunger_stripes: true,
          has_brood_patch: true,
          has_cpl_plus: false,
          comment: 'Ringablesung',
        }),
        bundle(),
      );

      expect(lesemodell.bird_status).toBe(BirdStatus.ReCatch);
      expect(lesemodell.date_time).toBe('2026-07-02T09:00');
      expect(lesemodell.net_location).toBe(3);
      expect(lesemodell.net_height).toBe(2);
      expect(lesemodell.net_direction).toBe(Direction.Right);
      expect(lesemodell.age_class).toBe(AgeClass.NotThisYear);
      expect(lesemodell.sex).toBe(Sex.Male);
      expect(lesemodell.small_feather_int).toBe(1);
      expect(lesemodell.small_feather_app).toBe('M' as never);
      expect(lesemodell.hand_wing).toBe(2);
      expect(lesemodell.tarsus).toBe(19.5);
      expect(lesemodell.feather_span).toBe(55);
      expect(lesemodell.wing_span).toBe(78);
      expect(lesemodell.weight_gram).toBe(17.5);
      expect(lesemodell.notch_f2).toBe(3);
      expect(lesemodell.inner_foot).toBe(9);
      expect(lesemodell.fat_deposit).toBe(0);
      expect(lesemodell.muscle_class).toBe(2);
      expect(lesemodell.parasites).toEqual([Parasit.RedMites, Parasit.Tick]);
      expect(lesemodell.has_hunger_stripes).toBeTrue();
      expect(lesemodell.has_brood_patch).toBeTrue();
      expect(lesemodell.has_cpl_plus).toBeFalse();
      expect(lesemodell.comment).toBe('Ringablesung');
    });

    // #469: ein Ring-vernichtet-Eintrag trägt schon in der Outbox keinen
    // Ringstatus — er ist weder Erstfang noch Wiederfang.
    it('gibt einen fehlenden Ringstatus als Abwesenheit weiter', () => {
      expect(lesemodellAusEintrag(eintrag({bird_status: null}), bundle()).bird_status).toBeNull();
    });

    /**
     * #232: die Zentrale reist im Schreib-Payload allein als EURING-Code, und
     * eine inländische Erfassung lässt sie ganz weg.
     */
    it('baut die Zentrale aus dem EURING-Code des Payloads', () => {
      expect(lesemodellAusEintrag(eintrag({central: 'SKB'}), null).central?.scheme_code).toBe('SKB');
      expect(lesemodellAusEintrag(eintrag(), null).central).toBeNull();
    });

    // Ein Payload ohne Zeitpunkt ist kein Fang ohne Zeitpunkt: die Uhrzeit der
    // Einreihung steht daneben und ist die ehrlichere Antwort als nichts.
    it('fällt für den Zeitpunkt auf die Einreihung zurück', () => {
      const lesemodell = lesemodellAusEintrag(eintrag({date_time: null}), null);

      expect(lesemodell.date_time).toBe('2026-07-02T09:05:00.000Z');
    });

    // #480: die beiden Fangmarker reisen auf Lese- und Schreibseite mit
    // (ADR 0026) — sie stehen wörtlich im Payload und brauchen kein Bundle.
    it('liest die beiden Fangmarker wörtlich aus dem Payload', () => {
      const gesetzt = lesemodellAusEintrag(
        eintrag({is_dead_recovery: true, is_non_standard: true}),
        null,
      );
      expect(gesetzt.is_dead_recovery).toBeTrue();
      expect(gesetzt.is_non_standard).toBeTrue();

      const ungesetzt = lesemodellAusEintrag(eintrag(), null);
      expect(ungesetzt.is_dead_recovery).toBeFalse();
      expect(ungesetzt.is_non_standard).toBeFalse();
    });
  });

  /**
   * #480: die Marker-Spalte in „Heute" liest ihre fünf Angaben aus **diesem**
   * Modell und nicht aus einer zweiten Lesung desselben Payloads — sie kann das,
   * weil `FangLesemodell` die `MarkerFakten` strukturell erfüllt.
   *
   * Die Zuweisungen unten sind der Beweis, und sie sind eine
   * **Übersetzungszeit**-Aussage: fiele hier eines der fünf Felder weg oder
   * änderte seinen Typ, bräche der Build. Ohne sie liefen die beiden Typen
   * lautlos auseinander und die Zeile widerspräche dem Dialog, den sie öffnet.
   */
  describe('erfüllt die MarkerFakten strukturell (#480)', () => {
    it('aus einem Fang-Datensatz', () => {
      const fakten: MarkerFakten = lesemodellAusFang(
        fang({has_brood_patch: true, is_dead_recovery: true, comment: 'Totfund; Umstände: Katze'}),
      );

      expect(fakten.has_brood_patch).toBeTrue();
      expect(fakten.is_dead_recovery).toBeTrue();
      expect(fakten.comment).toBe('Totfund; Umstände: Katze');
    });

    it('aus einem nicht synchronisierten Eintrag', () => {
      const fakten: MarkerFakten = lesemodellAusEintrag(
        eintrag({has_cpl_plus: true, is_non_standard: true, comment: 'Handfang'}),
        null,
      );

      expect(fakten.has_cpl_plus).toBeTrue();
      expect(fakten.is_non_standard).toBeTrue();
      expect(fakten.comment).toBe('Handfang');
    });
  });
});

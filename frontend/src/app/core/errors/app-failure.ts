import {HttpErrorResponse} from '@angular/common/http';

/**
 * Die Einordnung (ADR 0037, PRD #438): jeder Transportfehler wird auf einen
 * typisierten `AppFailure` abgebildet.
 *
 * **Ein Fehler wird danach benannt, was das Mitglied dagegen tun kann** — nicht
 * danach, was technisch passiert ist. Der HTTP-Status ist *Evidenz* für die
 * Einordnung, niemals die Einordnung selbst: eine doppelte Ringnummer und eine
 * fehlerhafte Dezimalzahl sind beide 400 und brauchen gegensätzliche Worte, und
 * ein 403 trägt heute nachweislich zwei gegensätzliche Fälle (siehe
 * `Fehlerklasse.NeuAnmelden` unten).
 *
 * Die Abbildung ist eine **reine Funktion** — Vorbild `plausibility.ts`: keine
 * Injektion, keine Signale, einmal gegen echte DRF-Antwortkörper getestet statt
 * pro Bildschirm nachgebaut.
 */

/**
 * Die sechs Fehlerklassen, jede mit genau einem Ausweg (ADR 0037).
 *
 * Die deutschen Namen sind Arbeitstitel für die Klassen; die *sichtbaren*
 * Überschriften stehen in `FEHLERKLASSE_WORTE`.
 */
export const Fehlerklasse = {
  /** Hier und jetzt berichtigen. Evidenz: 400/422 — ADR 0033s Positivliste — und 409. */
  Korrigieren: 'korrigieren',
  /** Warten oder nochmal drücken. Evidenz: Verbindungsabbruch, 5xx, 429. */
  ErneutVersuchen: 'erneut-versuchen',
  /** Anmelden und zurückkommen. Evidenz: 401 — und `not_authenticated`. */
  NeuAnmelden: 'neu-anmelden',
  /** Eine namentlich genannte Person bitten. Evidenz: 403. */
  FreigebenLassen: 'freigeben-lassen',
  /** „Jetzt aktualisieren" drücken. Evidenz: 404 auf bekanntem Endpunkt. */
  AppAktualisieren: 'app-aktualisieren',
  /** Nichts — es liegt an uns. Evidenz: alles übrige. */
  Unbekannt: 'unbekannt',
} as const;

export type Fehlerklasse = (typeof Fehlerklasse)[keyof typeof Fehlerklasse];

/**
 * Der eine Ausweg einer Klasse (ADR 0037, Spalte „Ausweg") — was dem Mitglied
 * angeboten wird, sobald die Klasse feststeht.
 *
 * Nicht zu verwechseln mit einer **code**-gebundenen Abhilfe („Als Wiederfang
 * erfassen", „freie Nummer übernehmen"): die hängt am Fehlercode, nicht an der
 * Klasse, und kommt mit #444. Ein Code, den dieser Client nicht kennt, bekommt
 * gar keine — er bekommt seinen Satz (ADR 0038).
 */
export type Abhilfe =
  | 'korrigieren'
  | 'erneut-versuchen'
  | 'neu-anmelden'
  | 'freigeben-lassen'
  | 'app-aktualisieren'
  | 'fehler-melden';

/**
 * Ein eingeordneter Fehlschlag.
 *
 * `status` und `original` reisen **mit**: die Abbildung ist additiv, nicht
 * zerstörend. Die Offline-Fassade verzweigt auf `status === 0`, der Sync liest
 * den `Retry-After`-Header vom Ursprungsfehler, und „Fehler melden" (#449)
 * braucht später Endpunkt und Status. Bauteile verzweigen trotzdem nicht auf den
 * Status — sie bekommen die Klasse.
 */
export interface AppFailure {
  /** Was das Mitglied dagegen tun kann. */
  readonly klasse: Fehlerklasse;
  /** Der stabile, maschinenlesbare Code des Servers — `null`, wo keiner mitkam. */
  readonly code: string | null;
  /** Das zurückgewiesene Feld, oder `null` für eine Zurückweisung des Datensatzes. */
  readonly field: string | null;
  /** Der Grund im Klartext — nie leer, nie ein Rohstatus, nie die Transportzeichenkette. */
  readonly text: string;
  /** Was eine Abhilfe an Daten braucht (ADR 0038), z.B. der kollidierende Erstfang. */
  readonly context: Record<string, unknown> | null;
  /** Der eine Ausweg der Klasse — aus ihr abgeleitet, nie eigenständig gewählt. */
  readonly remedy: Abhilfe;
  /** Der HTTP-Status als Evidenz — `null`, wo kein Transportfehler dahintersteht. */
  readonly status: number | null;
  /** Der unveränderte Ursprungsfehler. */
  readonly original: unknown;
}

/**
 * Ein Eintrag des `errors`-Umschlags (ADR 0038) — Geschwisterschlüssel neben der
 * unveränderten DRF-Form, ein Eintrag je deutschem Satz.
 */
interface ServerErrorEntry {
  field?: string | null;
  code?: string | null;
  detail?: string | null;
  context?: Record<string, unknown> | null;
}

/** Schlüssel, die eine Zurückweisung des Datensatzes als Ganzes tragen. */
const FIELDLESS_KEYS = new Set(['detail', 'non_field_errors', 'errors']);

/**
 * Ordnet einen beliebigen Fehler ein.
 *
 * Nimmt `unknown`, nicht `HttpErrorResponse`: an derselben Stelle können auch
 * lokale Lesefehler ankommen. Ohne Transport-Evidenz ist die Antwort
 * *Unbekannt* — und beschuldigt damit nie die Eingabe.
 */
export function classifyFailure(error: unknown): AppFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return {
      klasse: Fehlerklasse.Unbekannt,
      code: null,
      field: null,
      text: FEHLERKLASSE_WORTE[Fehlerklasse.Unbekannt].ersatzGrund,
      context: null,
      remedy: ABHILFE_JE_KLASSE[Fehlerklasse.Unbekannt],
      status: null,
      original: error,
    };
  }

  const entries = readEnvelope(error.error);
  const primary = entries.find((entry) => entry.field) ?? entries[0] ?? null;
  const klasse = classifyByEvidence(error.status, entries);

  return {
    klasse,
    code: primary?.code ?? null,
    field: primary?.field ?? null,
    text: readText(error, entries) || FEHLERKLASSE_WORTE[klasse].ersatzGrund,
    context: primary?.context ?? null,
    remedy: ABHILFE_JE_KLASSE[klasse],
    status: error.status,
    original: error,
  };
}

/**
 * Der Umschlag, der einen Synchronisierungsfehler **überdauert** (#445,
 * ADR 0038): was von einem eingeordneten Fehlschlag auf den geflaggten
 * `OutboxEntry` geschrieben wird, damit ein Tage später wieder geöffneter
 * zurückgewiesener Eintrag dasselbe vollständige Banner zeigt — ganz ohne Netz,
 * ohne Nachfassen, das selbst scheitern könnte.
 *
 * Es ist derselbe Umschlag wie auf der Leitung, in derselben Haltung: er reist
 * **additiv neben** `OutboxEntry.syncError`, der deutschen Zeile, die dort seit
 * #164 steht und dort byteweise stehen bleibt — genauso, wie `errors` neben der
 * unangetasteten DRF-Form reist. Der Satz steht deshalb an beiden Stellen; auf
 * der Leitung ist das der ausdrücklich angenommene Preis, und im Datensatz gilt
 * er aus demselben Grund: IndexedDB überlebt jeden Bundle-Tausch, und ein
 * Bundle, das den Umschlag noch nicht kennt, liest die Zeile weiterhin.
 *
 * `status` und `original` bleiben draußen. Nicht aus Sparsamkeit: der
 * Ursprungsfehler ist ein `HttpErrorResponse` und damit nicht strukturiert
 * klonbar — er würde den Schreibvorgang in die IndexedDB werfen lassen. Und ein
 * erinnerter Fehlschlag hat keinen Transport mehr hinter sich, auf den ein
 * Bauteil verzweigen dürfte.
 */
export interface SyncErrorEnvelope {
  readonly klasse: Fehlerklasse;
  readonly code: string | null;
  readonly field: string | null;
  readonly detail: string;
  readonly context: Record<string, unknown> | null;
}

/** Was von einem eingeordneten Fehlschlag auf den geflaggten Eintrag gehört. */
export function syncErrorEnvelopeOf(failure: AppFailure): SyncErrorEnvelope {
  return {
    klasse: failure.klasse,
    code: failure.code,
    field: failure.field,
    detail: failure.text,
    context: failure.context,
  };
}

/**
 * Der gemerkte Synchronisierungsfehler eines geflaggten `OutboxEntry`, zurück in
 * der Einordnung — damit ein wieder geöffneter zurückgewiesener Eintrag
 * **dasselbe Bauteil** rendert wie eine soeben abgelehnte Speicherung.
 *
 * Zwei Formen kommen hier an, und die zweite ist der Grund für das Ganze:
 *
 * 1. **Mit Umschlag** (#445): der ganze Fehlschlag, wie ihn die Leitung trug —
 *    Klasse, Code, Feld, Kontext. Der kollidierende Erstfang steht dann auch
 *    ohne Netz noch da.
 * 2. **Ohne Umschlag**: eine blanke Zeile Prosa, geschrieben von einem älteren
 *    Bundle (#164). Sie gilt als reines `detail`, und es wird ihr **kein Code
 *    erfunden** — es war keiner dabei. Ein Gerät, das wochenlang ohne Netz war,
 *    hält genau solche Einträge; sie sind der Grund, warum es diesen Mechanismus
 *    gibt. Die Klasse ist dann *Korrigieren*, und zwar nicht geraten: nur ein
 *    400/422 verdient überhaupt ein Flag (ADR 0033s Positivliste), und genau das
 *    **ist** diese Klasse.
 */
export function failureFromSyncError(
  message: string,
  envelope?: SyncErrorEnvelope | null,
): AppFailure {
  if (!envelope) {
    return localFailure(Fehlerklasse.Korrigieren, message);
  }
  // Was in IndexedDB liegt, überlebt das Bundle, das es schrieb — eine Klasse,
  // die dieser Client nicht kennt, darf das Banner nicht ohne Worte dastehen
  // lassen (dieselbe Haltung wie ADR 0031 gegenüber einem zurückgezogenen
  // Vokabular). *Korrigieren* ist der richtige Rückfall: geflaggt wird nur, was
  // der Beringer selbst berichtigen kann.
  const klasse = KNOWN_KLASSEN.has(envelope.klasse) ? envelope.klasse : Fehlerklasse.Korrigieren;
  return {
    klasse,
    code: envelope.code ?? null,
    field: envelope.field ?? null,
    text: message.trim() || envelope.detail?.trim() || FEHLERKLASSE_WORTE[klasse].ersatzGrund,
    context: envelope.context ?? null,
    remedy: ABHILFE_JE_KLASSE[klasse],
    status: null,
    original: null,
  };
}

const KNOWN_KLASSEN = new Set<Fehlerklasse>(Object.values(Fehlerklasse));

/**
 * Ein Fehlschlag ohne Transport dahinter — etwas, das am Gerät scheiterte oder
 * schon gescheitert *war*, und trotzdem auf dieselbe Oberfläche gehört. Der Satz
 * kommt hier von der App, nicht vom Server; die Klasse wählt die aufrufende
 * Stelle, weil nur sie weiß, was zu tun ist.
 */
export function localFailure(klasse: Fehlerklasse, text: string): AppFailure {
  return {
    klasse,
    code: null,
    field: null,
    text: text.trim() || FEHLERKLASSE_WORTE[klasse].ersatzGrund,
    context: null,
    remedy: ABHILFE_JE_KLASSE[klasse],
    status: null,
    original: null,
  };
}

/**
 * Die Einordnung selbst. Der Status ist die Evidenz — mit **zwei** Ausnahmen, und
 * beide sind genau der Grund, warum er nicht die Einordnung *ist*. Sie tragen
 * denselben Status 403 und drei gegensätzliche Auswege:
 *
 * 1. Eine abgelaufene oder fehlende Sitzung kommt bei DRFs
 *    `SessionAuthentication` als **403** an (es gibt keinen
 *    `WWW-Authenticate`-Header, also degradiert DRF 401 auf 403). Nach dem Status
 *    allein wäre das „Freigeben lassen" — die Aufforderung, eine Administratorin
 *    um etwas zu bitten, das nur eine erneute Anmeldung behebt.
 * 2. Eine **CSRF-Ablehnung** ist derselbe 403 wie eine Rechteverweigerung, und
 *    nochmal drücken ist die ganze Abhilfe. Ein Mitglied hier zu einer Kollegin
 *    zu schicken, obwohl sich die Sache von selbst erledigt, ist genau der
 *    Fehlgriff, den die Disambiguierung des 403 verhindern soll (#441, ADR 0037).
 *
 * DRFs eigener `not_authenticated` und der Domänencode `csrf_failed` trennen die
 * Fälle; beide reisen seit dem globalen Fehler-Handler (#440) gratis mit.
 */
function classifyByEvidence(status: number, entries: ServerErrorEntry[]): Fehlerklasse {
  if (entries.some((entry) => entry.code === 'not_authenticated')) {
    return Fehlerklasse.NeuAnmelden;
  }
  if (entries.some((entry) => entry.code === 'csrf_failed')) {
    return Fehlerklasse.ErneutVersuchen;
  }
  switch (status) {
    case 400:
    case 422:
    // Ein **409** ist derselbe Fall wie ein 400, nur über den Zustand statt über
    // die Eingabe: der Server hat den Vorgang selbst zurückgewiesen, den Grund
    // auf Deutsch genannt und einen stabilen Code mitgeschickt — eine Station
    // mit Fängen (`station_has_captures`, ADR 0011), ein Beringer mit Konto
    // (`beringer_has_account`), ein erreichtes Seat-Limit
    // (`seat_limit_reached`, ADR 0005). Jeder dieser Sätze nennt den anderen
    // Weg: archivieren statt löschen, erst das Konto entfernen, erst einen Sitz
    // frei machen.
    //
    // *Unbekannt* — die Klasse, in die er ohne diesen Zweig fiele — behauptete
    // darüber „Unerwarteter Fehler", „Das liegt an uns, nicht an deiner
    // Eingabe." und böte „Fehler melden" an: ein Bugreport über ein Feature,
    // das genau wie entworfen funktioniert, über einem Satz, der allen dreien
    // widerspricht.
    //
    // Es ist außerdem dieselbe Seite von ADR 0033s Trennlinie wie 400/422 — eine
    // Bedingung des *Vorgangs*, keine des Laufs. Der Replay hielte einen 409
    // sonst für ein Laufproblem und bräche die Warteschlange in jedem Anlauf
    // aufs Neue ab, obwohl keine Wiederholung einen Konflikt auflöst. Heute
    // erzeugt kein Endpunkt des Fangpfads einen 409, dort ändert sich also
    // nichts; käme je einer, wäre Flaggen die richtige Antwort.
    case 409:
      return Fehlerklasse.Korrigieren;
    case 401:
      return Fehlerklasse.NeuAnmelden;
    case 403:
      return Fehlerklasse.FreigebenLassen;
    case 404:
      return Fehlerklasse.AppAktualisieren;
    case 0:
    case 429:
      return Fehlerklasse.ErneutVersuchen;
  }
  return status >= 500 ? Fehlerklasse.ErneutVersuchen : Fehlerklasse.Unbekannt;
}

/** Die Einträge des `errors`-Umschlags, oder `[]`, wo keiner mitkam. */
function readEnvelope(body: unknown): ServerErrorEntry[] {
  if (!body || typeof body !== 'object') {
    return [];
  }
  const envelope = (body as {errors?: unknown}).errors;
  if (!Array.isArray(envelope)) {
    return [];
  }
  return envelope.filter(
    (entry): entry is ServerErrorEntry => !!entry && typeof entry === 'object',
  );
}

/**
 * Der Grund im Klartext. Drei Formen, in dieser Reihenfolge:
 *
 * 1. der `errors`-Umschlag — jeder Satz, in der Reihenfolge des Servers;
 * 2. die alte Form ganz ohne `errors` (`"…"`, `{detail: …}`, `{feld: […]}`,
 *    `[…]`) — ein von Hand gebauter `Response` durchläuft keinen
 *    Exception-Handler und trägt deshalb bis heute keinen Umschlag;
 * 3. nichts Brauchbares: dann der Ersatzsatz der Klasse.
 *
 * Was hier **nie** vorkommt, ist `HttpErrorResponse.message` — die
 * Transportzeichenkette „Http failure response for …: 400 OK", mit der dieses
 * PRD anfing.
 */
function readText(error: HttpErrorResponse, entries: ServerErrorEntry[]): string {
  const fromEnvelope = entries
    .map((entry) => entry.detail)
    .filter((detail): detail is string => typeof detail === 'string' && detail.trim().length > 0)
    .map((detail) => detail.trim());
  if (fromEnvelope.length > 0) {
    return fromEnvelope.join(' ');
  }
  return readLegacyBody(error.error);
}

/** Die Form vor dem Umschlag: ein Satz, `{detail: …}`, Feldfehler, eine Liste. */
function readLegacyBody(body: unknown): string {
  if (typeof body === 'string') {
    return body.trim();
  }
  if (Array.isArray(body)) {
    return collectSentences(body).join(' ');
  }
  if (!body || typeof body !== 'object') {
    return '';
  }
  const detail = (body as Record<string, unknown>)['detail'];
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  const sentences: string[] = [];
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (FIELDLESS_KEYS.has(key)) {
      continue;
    }
    sentences.push(...collectSentences(value));
  }
  return sentences.join(' ');
}

function collectSentences(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSentences(item));
  }
  return [];
}

/**
 * Wo die Einordnung am Ursprungsfehler hängt.
 *
 * Ein Symbol und nicht aufzählbar: der Fehler selbst bleibt damit **byteweise**
 * der, der er war — `instanceof HttpErrorResponse` trägt weiter, `status`,
 * `headers` und `error` stehen unangetastet da, und nichts, was den Fehler
 * serialisiert oder protokolliert, sieht die Anlagerung. Das ist dieselbe
 * Haltung wie beim Umschlag des Servers (ADR 0038): additiv, nie ersetzend.
 */
const APP_FAILURE = Symbol('AppFailure');

/**
 * Hängt die Einordnung an den Fehler, ohne ihn zu ersetzen, und gibt **denselben**
 * Fehler zurück. Nur der `failureInterceptor` ruft das.
 */
export function attachAppFailure<T>(error: T, failure: AppFailure): T {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    Object.defineProperty(error, APP_FAILURE, {
      value: failure,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return error;
}

/**
 * Die Einordnung eines Fehlers — die angehängte, wenn er durch den
 * `failureInterceptor` kam, sonst frisch berechnet.
 *
 * Das ist, was ein Bauteil aufruft. Es bekommt die **Klasse**; es verzweigt nie
 * auf den Status. Der Rückfall auf `classifyFailure` ist kein zweiter Weg,
 * sondern derselbe: die Abbildung ist rein, also liefert sie dieselbe Antwort —
 * er trägt bloß die Fehler mit, die nie über die Leitung liefen (ein lokaler
 * Lesefehler, ein Fehler aus einem Test-Stub ohne Interceptor-Kette).
 */
export function appFailureOf(error: unknown): AppFailure {
  const attached =
    error && typeof error === 'object'
      ? (error as {[APP_FAILURE]?: AppFailure})[APP_FAILURE]
      : undefined;
  return attached ?? classifyFailure(error);
}

/**
 * Die Worte je Klasse — Titel, Ausweg-Satz und der Ersatzgrund, wenn der Körper
 * gar keinen Satz trug. An genau einer Stelle, damit jede Oberfläche dieselben
 * Worte benutzt.
 */
export interface FehlerklasseWorte {
  /** Die Überschrift des Banners. */
  readonly titel: string;
  /** Der eine Ausweg, ausgeschrieben. */
  readonly ausweg: string;
  /** Der Grund, wenn der Server keinen mitschickte — nie leer, nie ein Rohstatus. */
  readonly ersatzGrund: string;
}

/** ADR 0037s Spalte „Ausweg", eins zu eins. */
export const ABHILFE_JE_KLASSE: Record<Fehlerklasse, Abhilfe> = {
  [Fehlerklasse.Korrigieren]: 'korrigieren',
  [Fehlerklasse.ErneutVersuchen]: 'erneut-versuchen',
  [Fehlerklasse.NeuAnmelden]: 'neu-anmelden',
  [Fehlerklasse.FreigebenLassen]: 'freigeben-lassen',
  [Fehlerklasse.AppAktualisieren]: 'app-aktualisieren',
  [Fehlerklasse.Unbekannt]: 'fehler-melden',
};

export const FEHLERKLASSE_WORTE: Record<Fehlerklasse, FehlerklasseWorte> = {
  [Fehlerklasse.Korrigieren]: {
    titel: 'Speichern abgelehnt',
    ausweg: 'Bitte korrigieren und erneut speichern.',
    ersatzGrund: 'Der Server hat die Eingabe abgelehnt.',
  },
  [Fehlerklasse.ErneutVersuchen]: {
    titel: 'Gerade nicht möglich',
    ausweg: 'Bitte versuche es noch einmal.',
    ersatzGrund: 'Der Server war gerade nicht erreichbar.',
  },
  [Fehlerklasse.NeuAnmelden]: {
    titel: 'Sitzung abgelaufen',
    ausweg: 'Bitte melde dich erneut an.',
    ersatzGrund: 'Die Sitzung ist abgelaufen.',
  },
  [Fehlerklasse.FreigebenLassen]: {
    titel: 'Nicht freigegeben',
    ausweg: 'Das darf nur eine Administratorin oder ein Administrator deiner Organisation.',
    ersatzGrund: 'Diese Aktion ist für dein Konto nicht freigegeben.',
  },
  [Fehlerklasse.AppAktualisieren]: {
    titel: 'Version veraltet',
    ausweg: 'Bitte aktualisiere die App.',
    ersatzGrund: 'Diese App-Version passt nicht mehr zum Server.',
  },
  [Fehlerklasse.Unbekannt]: {
    titel: 'Unerwarteter Fehler',
    ausweg: 'Das liegt an uns, nicht an deiner Eingabe.',
    ersatzGrund: 'Da ist etwas schiefgelaufen.',
  },
};

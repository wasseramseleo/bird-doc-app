import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
// Import toSignal
import {toSignal} from '@angular/core/rxjs-interop';
import {FormBuilder, FormGroupDirective, ReactiveFormsModule, Validators} from '@angular/forms';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import {ActivatedRoute, Router} from '@angular/router';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelect, MatSelectChange, MatSelectModule} from '@angular/material/select';
import {MatButtonModule} from '@angular/material/button';
import {MatAutocompleteModule, MatAutocompleteSelectedEvent} from '@angular/material/autocomplete';
import {MatDatepickerModule} from '@angular/material/datepicker';
import {MatNativeDateModule} from '@angular/material/core';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {provideNativeDateAdapter} from '@angular/material/core';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatBadgeModule} from '@angular/material/badge';

import {debounceTime, distinctUntilChanged, switchMap, startWith, map, tap} from 'rxjs/operators';
import {Observable} from 'rxjs';

import {
  AgeClass,
  BirdStatus,
  DataEntry,
  Direction,
  HandWingMoult,
  MuscleClass,
  Parasit,
  PARASIT_OPTIONS,
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
  SelectOption, FatClass
} from '../models/data-entry.model';
import {ApiService} from '../service/api.service';
import {DataEntryRefreshService} from '../service/data-entry-refresh.service';
import {DataAccessFacadeService} from '../service/data-access-facade.service';
import {UnsavedChangesService} from '../service/unsaved-changes.service';
import {ConnectivityService} from '../core/offline/connectivity';
import {isDurablyQueued} from '../core/offline/durable-write';
import {OutboxService} from '../service/outbox.service';
import {ProjectService} from '../service/project.service';
import {WorkbenchStorageService} from '../service/workbench-storage.service';
import {SoundService} from '../service/sound.service';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {resolveQueuedEntryDisplay} from '../core/offline/queued-entry-display';
import {OutboxEntry} from '../models/outbox-entry.model';
import {Species} from '../models/species.model';
import {OPTIONAL_FIELD_ORDER, OptionalField} from '../models/project.model';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {RingingStation} from '../models/ringing-station.model';
import {Scientist} from '../models/scientist.model';
import {RingSize} from '../models/ring.model';
import {AUW_SCHEME_CODE, Central, PROJEKT_ZENTRALE} from '../models/central.model';
import {SelectOnTabDirective} from '../core/directives/select-on-tab';
import {NumberMaskDirective} from '../shared/directives/number-mask';
import {MatTableModule} from '@angular/material/table';
import {DataEntryDetailDialogComponent} from './data-entry-detail-dialog/data-entry-detail-dialog';
import {
  BeringerCreateDialogComponent,
  BeringerCreateDialogResult,
} from './beringer-create-dialog/beringer-create-dialog';
import {ConfirmDialogComponent, ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';
import {TotFundDialogComponent, TotFundDialogData} from './tot-fund-dialog/tot-fund-dialog';
import {selectedOptionValidator} from '../shared/validators/selected-option.validator';
import {getAgeClassLabel, getSexLabel} from './data-entry-labels';
import {
  computePlausibilityWarnings,
  PlausibilityMeasurements,
  PlausibilityWarning,
  SpeciesNorm,
} from '../core/plausibility/plausibility';
import {
  AcknowledgedSignatures,
  computePlausibilitySignatures,
  reconcileAcknowledgedWarnings,
  resetAcknowledgedSignatures,
} from '../core/plausibility/plausibility-acknowledgment';
import {InfoDialogComponent, InfoDialogData} from '../shared/info-dialog/info-dialog';
import {MarkerSlotsComponent} from '../shared/marker-slots/marker-slots';
import {FailureBannerComponent} from '../shared/failure-banner/failure-banner';
import {LoadFailureComponent} from '../shared/load-failure/load-failure';
import {
  AppFailure,
  appFailureOf,
  failureFromSyncError,
  Fehlerklasse,
  localFailure,
} from '../core/errors/app-failure';

// #232: the strict Austrian (AUW) ring-size codes. When the Zentrale switches
// back from a foreign scheme to the Projekt-Zentrale, a free-text Größe that is
// not one of these is cleared so the restored dropdown never carries an unlisted
// value.
const AUSTRIAN_RING_SIZES = new Set<string>(Object.values(RingSize));

// #443: welcher Control zu welchem Feldnamen des Servers gehört. Die Schreibform
// ist flach (`species_id`), das Formular hält die Objekte (`species`) — siehe
// `transformFromForm()`. Alles Übrige heißt in beiden Welten gleich.
const CONTROL_FOR_SERVER_FIELD: Record<string, string> = {
  species_id: 'species',
  staff_id: 'staff',
  ringing_station_id: 'ringing_station',
};

/** Der Fehlerschlüssel, unter dem der Serversatz an einem Control hängt. */
const SERVER_REJECTED = 'serverRejected';

/**
 * #443: die Controls, deren Vorlage den Serversatz auch wirklich als `mat-error`
 * zeigt — **die einzigen, die markiert werden dürfen**.
 *
 * Der Schreib-Serializer kann jedes Feld zurückweisen, nicht nur die acht der
 * Kern-Maske: eine fehlerhafte Dezimalzahl im Gewicht ist genauso ein 400 wie
 * eine doppelte Ringnummer. Ein Control ohne `mat-error` zu markieren ergäbe ein
 * **rotes, stummes Feld** — rot, ohne einen Satz, der sagt warum. Deshalb ist
 * diese Liste die Bedingung: was hier nicht steht, wird nicht markiert und
 * erscheint allein im Banner, wo der Satz auf jeden Fall steht.
 *
 * Nicht dabei und bewusst so: `has_brood_patch`, `has_cpl_plus` und
 * `has_hunger_stripes` sind `mat-checkbox` und haben gar keinen Fehlerplatz, und
 * `is_dead_recovery`/`is_non_standard` sind Fangmarker ohne eigenes Eingabefeld.
 *
 * Die Liste ist exportiert, weil eine Spec sie durchgeht und für **jeden**
 * Eintrag beweist, dass der Satz danach am Feld steht — sonst driftete sie
 * lautlos von der Vorlage weg.
 */
export const SERVER_REJECTION_FIELDS: readonly string[] = [
  'ringing_station', 'staff', 'date_time', 'species', 'bird_status', 'central',
  'ring_size', 'ring_number',
  'net_location', 'net_height', 'net_direction',
  'age_class', 'sex', 'fat_deposit', 'muscle_class',
  'small_feather_int', 'small_feather_app', 'hand_wing',
  'tarsus', 'feather_span', 'wing_span', 'weight_gram',
  'comment', 'parasites', 'notch_f2', 'inner_foot',
];

const SERVER_REJECTION_FIELD_SET = new Set<string>(SERVER_REJECTION_FIELDS);

@Component({
  selector: 'app-data-entry-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatAutocompleteModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    SelectOnTabDirective,
    NumberMaskDirective,
    MatCheckboxModule,
    MatSnackBarModule,
    MatTableModule,
    MatDialogModule,
    MatIconModule,
    MatBadgeModule,
    MarkerSlotsComponent,
    FailureBannerComponent,
    LoadFailureComponent,
  ],
  providers: [provideNativeDateAdapter(), DatePipe, DecimalPipe],
  templateUrl: './data-entry-form.html',
  styleUrls: ['./data-entry-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
    '(keyup)': 'onKeyup($event)',
    '(mousedown)': 'onPointerOrFocus($event)',
    '(focusin)': 'onPointerOrFocus($event)',
  },
})
export class DataEntryFormComponent implements OnInit, AfterViewInit {
  // Services and Router
  private readonly fb = inject(FormBuilder);
  private readonly apiService = inject(ApiService);
  // Offline-aware reads (issue #159, PRD #152): species/Station/Beringer
  // pickers and the Ringnummer suggestion route through the facade so they
  // keep working from the cache when the server is unreachable. Everything
  // else (loading/saving an entry, quick-adding a Beringer) stays on
  // `apiService` — writes and single-record reads are out of this issue's
  // scope.
  private readonly dataAccess = inject(DataAccessFacadeService);
  // Issue #163: resolves whether /data-entry/:id points at a queued (nicht
  // synchronisiert) outbox entry or a synced server record, and owns the
  // edit/delete of the former — see the `entryId` effect and `onSubmit()`.
  private readonly outbox = inject(OutboxService);
  private readonly referenceCache = inject(ReferenceBundleCacheService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly storage = inject(WorkbenchStorageService);
  private readonly sound = inject(SoundService);
  private readonly datePipe = inject(DatePipe);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly entryRefresh = inject(DataEntryRefreshService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  // #407 (ADR 0032): publishes this form's dirty state so leaving it — or
  // adopting a new Version from the nav bar — can ask before discarding input.
  private readonly unsavedChanges = inject(UnsavedChangesService);

  readonly currentProject = this.projectService.currentProject;
  // #392 (ADR 0030): offline wird nicht gelöscht — „Eintrag löschen" sperrt sich
  // selbst. Bewusst NICHT auf die „synchronisiert ⇒ offline read-only"-Regel aus
  // CONTEXT.md gestützt: die ist heute nur an einer Stelle durchgesetzt (Heute-Seite)
  // und über die Fangliste umgehbar. Diese Lücke ist #386 und hier nicht Thema.
  readonly isOffline = this.connectivity.isOffline;
  // #430 (ADR 0035): the Optionale-Felder vocabulary, exposed so the template can
  // ask the single visibility question per field key.
  readonly OptionalField = OptionalField;
  // The Projekt's opt-out list — read from the active Projekt, so it is honoured
  // offline from the project cache on exactly the path the Projekte already take.
  // A Projekt (or a cached copy) that predates the field hides nothing, keeping
  // every optional field visible.
  private readonly hiddenOptionalFields = computed(
    () => new Set<OptionalField>(this.currentProject()?.hidden_optional_fields ?? []),
  );

  /**
   * #430 (ADR 0035): the one visibility question the form asks — „is this field key
   * visible?" — replacing the two separate all-or-nothing computations. Only the
   * seven vocabulary entries are switchable; Spine and Kern are never asked about.
   */
  isOptionalFieldVisible(field: OptionalField): boolean {
    return !this.hiddenOptionalFields().has(field);
  }

  // The Ja/Nein-Zeile of the optional block (Brutfleck, CPL+, Hungerstreifen,
  // Parasit) and the two optional Messwerte (Kerbe F2, Innenfuß) each live in their
  // own container; the container goes away entirely once every field inside it is
  // switched off, rather than leaving an empty row behind.
  readonly showOptionalCheckboxRow = computed(() =>
    [
      OptionalField.Brutfleck,
      OptionalField.CplPlus,
      OptionalField.Hungerstreifen,
      OptionalField.Parasit,
    ].some((field) => !this.hiddenOptionalFields().has(field)),
  );
  readonly showOptionalMeasurements = computed(() =>
    [OptionalField.KerbeF2, OptionalField.Innenfuss].some(
      (field) => !this.hiddenOptionalFields().has(field),
    ),
  );

  // Component State
  private readonly entryId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  readonly isEditMode = computed(() => !!this.entryId());
  // #24: the bound FormGroupDirective. Resets routed through it clear the
  // "submitted" flag (entryForm.reset() alone leaves it set), which is what stops
  // every empty required field from showing an error after a save.
  private readonly formDirective = viewChild(FormGroupDirective);
  // #24: the record loaded in edit mode, kept so Zurücksetzen can restore its
  // saved values instead of emptying the form.
  private readonly loadedEntry = signal<DataEntry | null>(null);
  // Issue #163: set instead of `loadedEntry` when `entryId` resolves to a
  // queued outbox entry rather than a synced server record — editing it
  // saves back into the outbox (re-queue) instead of PUTting to the server.
  private readonly loadedQueuedEntry = signal<OutboxEntry | null>(null);
  readonly isQueuedEditMode = computed(() => this.loadedQueuedEntry() !== null);
  // Issue #164: the server's rejection when this queued entry was
  // skipped-and-flagged during sync — shown as a banner so the Mitglied knows
  // exactly what to fix before re-saving (which re-queues it clean). `null`
  // for an ordinary, never-rejected queued entry. #443: lifted into the shared
  // AppFailure shape so it renders through the *same* banner an online
  // rejection does. #445: the entry carries the whole rejection now — Klasse,
  // Code, Feld, Kontext beside the sentence — so this banner is complete days
  // later with no network at all, colliding Erstfang included. An entry an
  // older bundle flagged has only the sentence, and it stays exactly that: a
  // bare `detail` with no invented code.
  readonly syncFailure = computed(() => {
    const entry = this.loadedQueuedEntry();
    return entry?.syncError
      ? failureFromSyncError(entry.syncError, entry.syncErrorEnvelope)
      : null;
  });
  // #443 (ADR 0037): the server's rejection of a save the Beringer just
  // gestured for — classified, never a transport string, and it does not time
  // out. Cleared when the next attempt starts and when one succeeds.
  private readonly saveFailure = signal<AppFailure | null>(null);
  // One banner, two moments. A fresh rejection wins over an older
  // Synchronisierungsfehler: it is the answer to the button just pressed.
  readonly bannerFailure = computed(() => this.saveFailure() ?? this.syncFailure());
  // Only the *heading* knows the moment (ADR 0037): a rejection met during a
  // replay says so, an online one gets its class's own title.
  readonly bannerTitel = computed(() =>
    this.saveFailure() ? null : 'Synchronisierung abgelehnt',
  );
  // #444: das Formular hat nach der nächsten freien Ringnummer gefragt und
  // keine bekommen. Dann steht im Banner ein Satz statt eines Knopfes, der
  // wortlos nichts täte — und die getippte Nummer bleibt, wo sie ist.
  readonly keineFreieNummer = signal(false);
  // What "Erneut versuchen" means for the failure currently on screen. The
  // banner only reports that it was pressed; only this form knows which errand
  // failed — a save, a Ringhistorie lookup, a delete.
  private readonly retryAction = signal<(() => void) | null>(null);
  // The queued entry's payload resolved to display-ready form values (issue
  // #163), kept alongside `loadedQueuedEntry` so Zurücksetzen can restore it
  // without re-reading the reference cache.
  private readonly loadedQueuedFormValue = signal<Record<string, unknown> | null>(null);
  readonly loading = signal<boolean>(false);
  // #385: the GET behind /data-entry/:id failed. Distinct from `syncError`
  // (the server rejected a *queued* entry during sync): this one means the
  // record never arrived, so there is nothing to edit and the form must not
  // render. Any failure lands here — 5xx, timeout, dropped connection, or
  // status 0 while offline. Only the server path can set it; the queued path
  // reads local state and cannot fail this way.
  // #446 (ADR 0037): aus dem Flag ist die Einordnung geworden — dieselbe, aus
  // der `saveFailure` seine Worte bezieht. Die Oberflächen bleiben getrennt:
  // ein gescheitertes *Laden* ersetzt den Inhalt an Ort und Stelle und bekommt
  // nie ein Banner.
  readonly loadFailure = signal<AppFailure | null>(null);
  // MO-3 submit feedback: drives the brief green "Gespeichert ✓" button state.
  readonly saved = signal<boolean>(false);
  // #23: a prominent CapsLock warning. Beringer type ring numbers and codes
  // blind; an unnoticed CapsLock would silently corrupt single-char shortcuts.
  readonly capsLockOn = signal<boolean>(false);

  // Recapture History State
  readonly recaptureHistory = signal<DataEntry[]>([]);
  // Issue #168: true when the current "Bisherige Fänge" panel was assembled
  // offline from this device's local sources (queued + cached captures) rather
  // than fetched complete from the server — drives the "möglicherweise
  // unvollständig" label so the Beringer knows captures made on another device
  // or before this device's cache snapshot may be missing.
  readonly historyPossiblyIncomplete = signal<boolean>(false);
  // #405: 'marker' ersetzt die frühere 'actions'-Spalte — sie trägt keine Aktion
  // mehr, sondern die drei Marker-Slots aus #388. Den Detail-Dialog öffnet jetzt
  // der Zeilenklick.
  readonly displayedHistoryColumns: string[] = [
    'date_time', 'species', 'bird_status', 'staff', 'tarsus', 'feather_span', 'wing_span', 'weight_gram',
    'age_class', 'sex', 'marker'
  ];
  readonly BirdStatus = BirdStatus;

  // #405: die Beschreibung des Anzahl-Badges für Screenreader — ohne sie liest
  // ein Screenreader die nackte Zahl („Bisherige Fänge 3").
  readonly historyCountDescription = computed(() => {
    const count = this.recaptureHistory().length;
    return count === 1 ? '1 Eintrag' : `${count} Einträge`;
  });

  // #115: a determined-sex contradiction across the recapture history. Only
  // determined sexes (Männchen/Weibchen) count towards the set; Unbekannt is
  // excluded, so an Unbekannt → determined progression is not a contradiction.
  // A history that carries BOTH Männchen and Weibchen cannot describe one ringed
  // bird, so it is flagged. Age class never participates.
  readonly hasSexContradiction = computed(() => {
    const determinedSexes = new Set(
      this.recaptureHistory()
        .map((entry) => entry.sex)
        .filter((sex) => sex === Sex.Male || sex === Sex.Female),
    );
    return determinedSexes.size >= 2;
  });

  // #115: the "Bisherige Fänge" summary shows Alter/Geschlecht as readable
  // German labels, not the raw coded integers. The maps are shared with the
  // detail dialog via data-entry-labels.
  readonly getAgeClassLabel = getAgeClassLabel;
  readonly getSexLabel = getSexLabel;

  // Form Definition
  entryForm = this.fb.group({
    // #58: each autocomplete must hold a real selected record, not free text the
    // user typed but never picked — selectedOptionValidator fails the latter inline
    // so it never POSTs a missing id and surfaces as an opaque 400.
    ringing_station: [null as RingingStation | null, [Validators.required, selectedOptionValidator]],
    staff: [null as Scientist | null, [Validators.required, selectedOptionValidator]],
    date_time: [this.getInitialDateTime(), Validators.required],
    species: [null as Species | null, [Validators.required, selectedOptionValidator]],
    bird_status: [null as BirdStatus | null, Validators.required],
    // #232: the ring's Zentrale (EURING scheme). Defaults to the Projekt-Zentrale
    // (AUW today); disabled+forced to it on Erstfang/Ring-vernichtet, enabled and
    // searchable on a Wiederfang. selectedOptionValidator (like Art/Station/
    // Beringer) refuses a typed-but-unpicked term so a mistyped foreign Zentrale
    // never silently saves as domestic.
    central: [PROJEKT_ZENTRALE as Central | null, [selectedOptionValidator]],
    ring_size: [null as RingSize | null, Validators.required],
    ring_number: ['', [Validators.required, Validators.pattern('^[0-9]*$')]],
    net_location: [null as number | null],
    net_height: [null as number | null],
    net_direction: [null as Direction | null],
    fat_deposit: [null as FatClass | null],
    muscle_class: [null as MuscleClass | null],
    age_class: [AgeClass.Unknown, Validators.required],
    sex: [Sex.Unknown, Validators.required],
    small_feather_int: [null as SmallFeatherIntMoult | null],
    small_feather_app: [null as SmallFeatherAppMoult | null],
    hand_wing: [null as HandWingMoult | null],
    tarsus: [null as number | null],
    feather_span: [null as number | null],
    wing_span: [null as number | null],
    weight_gram: [null as number | null],
    notch_f2: [null as number | null],
    inner_foot: [null as number | null],
    comment: [null as string | null],
    has_hunger_stripes: [false, Validators.required],
    has_brood_patch: [false, Validators.required],
    has_cpl_plus: [false, Validators.required],
    // Parasit (ADR 0027): a Mehrfachauswahl of parasite-type codes, replacing the
    // former single Milben checkbox. Defaults to an empty list; getRawValue()
    // carries it onto the write payload (and the offline outbox).
    parasites: [[] as Parasit[]],
    // Fangmarker (ADR 0026): toggled by the action-row buttons, never typed. They
    // are form controls only so getRawValue() carries them onto the write payload
    // (and thus through the offline outbox) and transformToForm patches them back
    // on edit — they are not rendered as inputs.
    is_dead_recovery: [false],
    is_non_standard: [false],
  });

  // Signals for reactive form values
  private readonly ringSize = toSignal(this.entryForm.get('ring_size')!.valueChanges);
  // #25: the selected ring size reads together with the number — it is shown as a
  // text prefix directly before the Ringnummer field (e.g. `V 1234`).
  readonly ringSizePrefix = computed(() => this.ringSize() ?? '');
  private readonly birdStatus = toSignal(this.entryForm.get('bird_status')!.valueChanges);
  readonly isRecatch = computed(() => this.birdStatus() === BirdStatus.ReCatch);

  // #232: the selected Zentrale drives the free-text switching. A foreign Zentrale
  // is a selected Central record whose scheme code is not AUW (the Projekt-
  // Zentrale). A half-typed search term (a raw string) or a null value counts as
  // NOT foreign, so the strict Austrian dropdown holds until a real foreign
  // Zentrale is actually picked.
  private readonly centralValue = toSignal(this.entryForm.get('central')!.valueChanges, {
    initialValue: this.entryForm.get('central')!.value,
  });
  readonly isForeignCentral = computed(() => {
    const central = this.centralValue();
    return (
      !!central && typeof central === 'object' && (central as Central).scheme_code !== AUW_SCHEME_CODE
    );
  });

  // #26: only the Kleingefieder *Fortschritt* (small-feather moult progress,
  // J/U/M/N) is recorded for diesjährige birds (Alter = 3) alone — it tracks the
  // post-juvenile moult that only a this-year bird undergoes. The *Intensität*
  // and the Handschwingenmauser are recorded for every age class. Track the age
  // class so the Fortschritt field can react to changes; seed with the form's
  // current value since valueChanges does not emit until the first change.
  private readonly ageClass = toSignal(this.entryForm.get('age_class')!.valueChanges, {
    initialValue: this.entryForm.get('age_class')!.value,
  });
  readonly isDiesjaehrig = computed(() => this.ageClass() === AgeClass.ThisYear);

  // Issue #19/#57: the selected Art drives the Sonderart behaviours, keyed off
  // its special_kind. A 'ring_destroyed' Art ("Ring Vernichtet") collapses the
  // form to the essentials; an 'unknown_species' Art ("Aves ignota") is a real
  // bird that keeps the full form but makes the Bemerkung mandatory.
  readonly selectedSpecies = signal<Species | null>(null);
  readonly isRingDestroyed = computed(
    () => this.selectedSpecies()?.special_kind === 'ring_destroyed',
  );
  readonly isUnknownSpecies = computed(
    () => this.selectedSpecies()?.special_kind === 'unknown_species',
  );
  // The 'Ring Vernichtet' Art the quick-button applies, fetched once on init
  // (the backend always includes Sonderart rows in the species list). Keyed off
  // special_kind === 'ring_destroyed', not the German name.
  private readonly ringDestroyedSpecies = signal<Species | null>(null);

  // Fangmarker (ADR 0026): the two capture-level markers, tracked as signals off
  // their form controls so the coloured frame/badge, the mandatory-Bemerkung and
  // the button toggle-state all react. They flag a situation WITHOUT replacing the
  // Art, so they coexist with any Art (including Aves ignota) and with each other.
  private readonly deadRecoveryValue = toSignal(
    this.entryForm.get('is_dead_recovery')!.valueChanges,
    {initialValue: this.entryForm.get('is_dead_recovery')!.value},
  );
  readonly isDeadRecovery = computed(() => !!this.deadRecoveryValue());
  private readonly nonStandardValue = toSignal(
    this.entryForm.get('is_non_standard')!.valueChanges,
    {initialValue: this.entryForm.get('is_non_standard')!.value},
  );
  readonly isNonStandard = computed(() => !!this.nonStandardValue());
  // The exact composed Bemerkung prefix for a Tot-Fund (ADR 0026): the
  // Todesumstände lives only inside `Totfund; Umstände: <Eingabe>`, never as a
  // separate field, so it is composed on confirm and parsed back on edit.
  private static readonly TOTFUND_PREFIX = 'Totfund; Umstände: ';

  // PRD #245: the per-org effective Artennormen keyed by species_id, loaded from
  // the offline reference bundle (the same list the /species-norms/ API serves),
  // so the plausibility lookup is identical online and offline.
  private readonly normsBySpecies = signal<Record<string, SpeciesNorm>>({});
  // The effective Artennorm for the currently selected Art, or null when the Art
  // carries none (then no plausibility check fires).
  readonly activeNorm = computed<SpeciesNorm | null>(() => {
    const species = this.selectedSpecies();
    return species ? (this.normsBySpecies()[species.id] ?? null) : null;
  });
  // The active Plausibilitätswarnungen, recomputed on measurement blur and at
  // submit from computePlausibilityWarnings — the single source shared by the
  // inline hint and the save-time acknowledgment. Transient, never persisted.
  readonly plausibilityWarnings = signal<PlausibilityWarning[]>([]);
  // The active Warnungen indexed by their measurement field, so the template can
  // surface each field's inline hint by name (weight_gram, feather_span,
  // wing_span, tarsus, notch_f2, inner_foot). Reactive: recomputed whenever
  // plausibilityWarnings changes.
  readonly warningByField = computed<Record<string, string>>(() => {
    const byField: Record<string, string> = {};
    for (const warning of this.plausibilityWarnings()) {
      byField[warning.field] = warning.message;
    }
    return byField;
  });

  // PRD #261 (#265/#266): the quiet matSuffix warning icon that replaces the
  // verbose inline hint — numeric (#265) and categorical (#266) alike. A field's
  // icon shows whenever its own warning is active: the six σ-band fields, the two
  // categorical flags (Geschlecht `sex`, dj-Großgefiedermauser `hand_wing`), and
  // — for the two Quotient operands — whenever the derived Quotient breaches (the
  // Quotient has no field of its own, so it marks BOTH Federlänge and Flügellänge).
  // `age_class` only gates the dj rule and carries no icon of its own. Keyed by
  // field → its active message (the icon's hover title). Reactive off
  // warningByField, so it survives a modal dismissal (the warning stays active
  // until the value changes).
  readonly suffixWarningByField = computed<Record<string, string>>(() => {
    const byField = this.warningByField();
    const result: Record<string, string> = {};
    for (const field of ['weight_gram', 'tarsus', 'notch_f2', 'inner_foot', 'sex', 'hand_wing']) {
      if (byField[field]) {
        result[field] = byField[field];
      }
    }
    const quotient = byField['quotient'];
    const feather = byField['feather_span'] ?? quotient;
    const wing = byField['wing_span'] ?? quotient;
    if (feather) {
      result['feather_span'] = feather;
    }
    if (wing) {
      result['wing_span'] = wing;
    }
    return result;
  });

  // PRD #261 (#265): the transient per-field acknowledged signatures the „fire
  // once, never nag" de-dup rides. Nothing is persisted — an Art change or a
  // clean reset wipes it (resetAcknowledgedSignatures). Routed through
  // reconcileAcknowledgedWarnings so a value that already raised the modal never
  // nags again until it changes.
  private readonly acknowledgedSignatures = signal<AcknowledgedSignatures>(
    resetAcknowledgedSignatures(),
  );

  // #340: when a save-reset re-reads the clock and the freshly-suggested Uhrzeit
  // snaps to a *different* top-of-hour than the entry just saved, this holds the
  // two hours so the time field can raise a calm, non-blocking „Stunde gewechselt"
  // hint with a one-click revert to the previous hour. Never blocking, never a
  // modal, and never sticky — recomputed fresh on every save (null = no hint),
  // cleared the moment the user reverts. Transient, never persisted.
  readonly hourChangeHint = signal<{ previousDateTime: string; suggestedDateTime: string } | null>(
    null,
  );
  // The alert note surfaced in the top banner (#357): „⚠ Stunde gewechselt auf
  // HH:00 — noch Vögel aus der letzten Runde?" — HH:00 is the freshly-suggested hour.
  readonly hourChangeMessage = computed<string>(() => {
    const hint = this.hourChangeHint();
    return hint
      ? `⚠ Stunde gewechselt auf ${this.hourLabel(hint.suggestedDateTime)} — noch Vögel aus der letzten Runde?`
      : '';
  });
  // The one-click revert action label „auf HH:00 zurück" — HH:00 is the previous
  // (just-saved) hour it writes back into the time field.
  readonly hourChangeRevertLabel = computed<string>(() => {
    const hint = this.hourChangeHint();
    return hint ? `auf ${this.hourLabel(hint.previousDateTime)} zurück` : '';
  });

  // #155: a fresh client-generated UUID identifies this capture-create attempt
  // end-to-end, so a retried/replayed offline-outbox create is never duplicated
  // server-side (the idempotency keystone for PRD #152). Regenerated after
  // every successful create in cleanReset(); edit mode never sends it (see
  // transformFromForm), so editing an existing capture never touches its key.
  private idempotencyKey = crypto.randomUUID();

  // #155: snapshot (JSON) of the raw form value from the most recently *failed*
  // create submit, or null when there is none to compare against. A resubmit
  // after a failure is only safe to replay under the same idempotency_key when
  // it is a true retry — the exact same payload, e.g. the first POST actually
  // reached and was persisted by the server but its response was lost on a
  // flaky connection. If the user edits the form before resubmitting, replaying
  // the same key would make create_capture() silently hand back the original,
  // now-stale record instead of saving the edit — so onSubmit() mints a fresh
  // key whenever the resubmitted content differs from this snapshot. Cleared on
  // every successful save (cleanReset()); edit mode never uses this, since it
  // never sends an idempotency_key at all.
  private lastFailedSubmission: string | null = null;

  // Autocomplete Observables
  filteredSpecies!: Observable<Species[]>;
  filteredStations!: Observable<RingingStation[]>;
  filteredScientists!: Observable<Scientist[]>;
  filteredCentrals!: Observable<Central[]>;

  // Kürzel-first Beringer field: track the typed text and the matches so the
  // template can offer inline creation when an unknown Kürzel is typed.
  private readonly staffSearchTerm = signal('');
  private readonly staffResults = signal<Scientist[]>([]);
  readonly newBeringerKuerzel = computed(() => this.staffSearchTerm().trim());
  readonly showCreateBeringer = computed(() => {
    const term = this.newBeringerKuerzel();
    if (!term) {
      return false;
    }
    const needle = term.toLowerCase();
    return !this.staffResults().some(
      (s) => s.handle.toLowerCase() === needle || s.full_name.toLowerCase() === needle,
    );
  });

  // #430 (ADR 0035): which form controls each vocabulary entry gates — kept as one
  // table so the rendering, the focus order and the disabling effect stay in
  // lock-step. The Netz-Block is one entry over three controls, which is exactly
  // why the three are never switchable individually.
  private static readonly OPTIONAL_FIELD_CONTROLS: Readonly<
    Record<OptionalField, readonly string[]>
  > = {
    [OptionalField.Brutfleck]: ['has_brood_patch'],
    [OptionalField.CplPlus]: ['has_cpl_plus'],
    [OptionalField.Hungerstreifen]: ['has_hunger_stripes'],
    [OptionalField.Parasit]: ['parasites'],
    [OptionalField.KerbeF2]: ['notch_f2'],
    [OptionalField.Innenfuss]: ['inner_foot'],
    [OptionalField.NetzBlock]: ['net_location', 'net_height', 'net_direction'],
  };

  // #341: every numeric control wearing the appNumberMask (both Netz-Nummern +
  // the six Messwerte). Rendered as type="text", so their value accessor is the
  // DefaultValueAccessor: clearing a typed value leaves the control holding the
  // empty string "" (the old type="number" NumberValueAccessor coerced ""→null),
  // and the mask deliberately permits an in-progress lone/trailing dot ("5.",
  // "."). DRF's IntegerField rejects "" with a 400 and DecimalField rejects a
  // dangling-dot string, so transformFromForm() normalises these on the write
  // payload (see normalizeMaskedNumeric) — a cleared correction saves as null
  // again instead of failing.
  private static readonly MASKED_NUMERIC_CONTROLS: readonly string[] = [
    'net_location', 'net_height',
    'tarsus', 'feather_span', 'wing_span', 'weight_gram', 'notch_f2', 'inner_foot',
  ];

  private readonly baseFocusOrder: string[] = [
    'ringing_station', 'staff', 'date_time', 'species', 'bird_status', 'central', 'ring_size', 'ring_number',
    'net_location', 'net_height', 'net_direction', 'age_class', 'sex', 'fat_deposit', 'muscle_class',
    'small_feather_int', 'small_feather_app', 'hand_wing',
    'tarsus', 'feather_span', 'wing_span', 'weight_gram', 'comment',
    // #7a (ADR 0027): the Ja/Nein flags in Beringer-assessment order, then the
    // Parasit Mehrfachauswahl.
    'has_brood_patch', 'has_cpl_plus', 'has_hunger_stripes', 'parasites',
    'notch_f2', 'inner_foot'
  ];

  // #336/#430: a control the Projekt switched off drops out of the focus/arrow
  // order entirely, so Tab/Enter/arrow-nav never lands on a hidden input (it is
  // also disabled by the effect below). With nothing switched off the order is
  // unchanged.
  private get focusOrder(): string[] {
    const hidden = this.hiddenOptionalControls();
    if (hidden.size === 0) {
      return this.baseFocusOrder;
    }
    return this.baseFocusOrder.filter((name) => !hidden.has(name));
  }

  // The form-control names behind the currently switched-off vocabulary entries.
  private readonly hiddenOptionalControls = computed(() => {
    const names = new Set<string>();
    for (const field of OPTIONAL_FIELD_ORDER) {
      if (this.hiddenOptionalFields().has(field)) {
        for (const name of DataEntryFormComponent.OPTIONAL_FIELD_CONTROLS[field]) {
          names.add(name);
        }
      }
    }
    return names;
  });

  birdStatusOptions: SelectOption<BirdStatus | null>[] = [
    {value: null, viewValue: '---'},
    {value: BirdStatus.FirstCatch, viewValue: 'Erstfang (e)', key: 'e'},
    {value: BirdStatus.ReCatch, viewValue: 'Wiederfang (w)', key: 'w'}
  ];

  // Parasit (ADR 0027): the fixed, app-wide vocabulary rendered as the
  // Mehrfachauswahl's options.
  readonly parasitOptions: readonly SelectOption<Parasit>[] = PARASIT_OPTIONS;

  directionOptions: SelectOption<Direction | null>[] = [
    {value: null, viewValue: '---'},
    {value: Direction.Left, viewValue: 'Links (l)', key: 'l'},
    {value: Direction.Right, viewValue: 'Rechts (r)', key: 'r'}
  ];

  muscleClassOptions: SelectOption<MuscleClass | null>[] = [{value: null, viewValue: '---'}, {
    value: MuscleClass.Null,
    viewValue: '0 - Brustbein nicht fühlbar',
    key: '0'
  }, {value: MuscleClass.One, viewValue: '1 - Brustbein gut fühlbar', key: '1'}, {
    value: MuscleClass.Two,
    viewValue: '2 - Brustbein kaum fühlbar',
    key: '2'
  }, {value: MuscleClass.Three, viewValue: '3 - Brustbein nicht fühlbar (konvex)', key: '3'},];

  ageClassOptions: SelectOption<AgeClass>[] = [{
    value: AgeClass.Nest,
    viewValue: '1 - Nestling',
    key: '1'
  }, {value: AgeClass.Unknown, viewValue: '2 - Fängling (unbekannt)', key: '2'}, {
    value: AgeClass.ThisYear,
    viewValue: '3 - Diesjährig',
    key: '3'
  }, {value: AgeClass.NotThisYear, viewValue: '4 - Nicht Diesjährig', key: '4'}, {
    value: AgeClass.LastYear,
    viewValue: '5 - Vorjährig',
    key: '5'
  }, {value: AgeClass.NotLastYear, viewValue: '6 - Nicht Vorjährig', key: '6'},];

  sexOptions: SelectOption<Sex>[] = [{value: Sex.Unknown, viewValue: '0 - Unbekannt', key: '0'}, {
    value: Sex.Male,
    viewValue: '1 - Männlich',
    key: '1'
  }, {value: Sex.Female, viewValue: '2 - Weiblich', key: '2'},];

  smallFeatherIntOptions: SelectOption<SmallFeatherIntMoult | null>[] = [{
    value: null,
    viewValue: '---'
  }, {value: SmallFeatherIntMoult.None, viewValue: '0 - keine', key: '0'}, {
    value: SmallFeatherIntMoult.Some,
    viewValue: '1 - bis zu 20 Federn',
    key: '1'
  }, {value: SmallFeatherIntMoult.Many, viewValue: '2 - mehr als 20 Federn', key: '2'},];

  smallFeatherAppOptions: SelectOption<SmallFeatherAppMoult | null>[] = [{
    value: null,
    viewValue: '---'
  }, {
    value: SmallFeatherAppMoult.Juvenile,
    viewValue: 'J - Eben flügger Jungvogel',
    key: 'j'
  }, {
    value: SmallFeatherAppMoult.Unmoulted,
    viewValue: 'U - Weniger als 1/3 erneuert',
    key: 'u'
  }, {
    value: SmallFeatherAppMoult.Mixed,
    viewValue: 'M - Zwischen 1/3 und 2/3 erneuert',
    key: 'm'
  }, {value: SmallFeatherAppMoult.New, viewValue: 'N - Mehr als 2/3 erneuert', key: 'n'},];

  handWingMoultOptions: SelectOption<HandWingMoult | null>[] = [{
    value: null,
    viewValue: '---'
  }, {value: HandWingMoult.None, viewValue: '0 - Keine Handschwingen wachsen', key: '0'}, {
    value: HandWingMoult.NoneOld,
    viewValue: '1 - Alle sind unvermausert',
    key: '1'
  }, {value: HandWingMoult.AtLeastOne, viewValue: '2 - Mindestens eine mausert', key: '2'}, {
    value: HandWingMoult.All,
    viewValue: '3 - Alle vermausert',
    key: '3'
  }, {value: HandWingMoult.Part, viewValue: '4 - Ein Teil ist vermausert', key: '4'},];

  fatClassOptions: SelectOption<FatClass | null>[] = [{value: null, viewValue: '---'}, {
    value: FatClass.Null,
    viewValue: '0',
    key: '0'
  }, {value: FatClass.One, viewValue: '1', key: '1'}, {
    value: FatClass.Two,
    viewValue: '2',
    key: '2'
  }, {value: FatClass.Three, viewValue: '3', key: '3'}, {
    value: FatClass.Four,
    viewValue: '4',
    key: '4'
  }, {value: FatClass.Five, viewValue: '5', key: '5'}, {
    value: FatClass.Six,
    viewValue: '6',
    key: '6'
  }, {value: FatClass.Seven, viewValue: '7', key: '7'}, {value: FatClass.Eight, viewValue: '8', key: '8'},];

  // #25: every Austrian ring size, ordered largest → smallest (the RingSize
  // member order). The field shows only the bare code; selection is by native
  // type-ahead, so there is no single-character `key` shortcut (codes like AS/DS
  // are multi-letter).
  ringSizeOptions: SelectOption<RingSize>[] = Object.values(RingSize).map((size) => ({
    value: size,
    viewValue: size,
  }));

  constructor() {
    // #407 (ADR 0032): the dirty state is private to this form, but the
    // CanDeactivate guard and the nav bar's "Jetzt aktualisieren" both have to
    // know whether anyone is mid-capture before they throw the input away.
    // Publish it for this form's lifetime; the same `dirty` test Zurücksetzen
    // uses (#24).
    const unsavedChangesProbe = () => this.entryForm.dirty;
    this.unsavedChanges.watch(unsavedChangesProbe);
    this.destroyRef.onDestroy(() => this.unsavedChanges.stopWatching(unsavedChangesProbe));

    // Corrected effect to auto-set ring number.
    // It now reads the ringSize() and birdStatus() signals.
    effect(() => {
      const size = this.ringSize();
      const status = this.birdStatus();
      if (size && status === BirdStatus.FirstCatch && !this.isEditMode()) {
        // Scope the suggestion to the current Projekt so the next number tracks
        // this campaign's Erstfang rings rather than the global maximum (#22).
        const projectId = this.currentProject()?.id;
        this.dataAccess.getNextRingNumber(size, projectId).subscribe(res => {
          // Populate the field with the suggestion verbatim so leading zeros
          // (e.g. "0043") survive; leave it empty when there is none (#42).
          this.entryForm.get('ring_number')?.setValue(res.next_number ?? '');
        });
      }
    });

    // #444: „Es gibt keine freie Nummer" gilt für die Ringgröße, für die
    // gefragt wurde. Wählt der Beringer eine andere, ist die Antwort hinfällig
    // — sonst bliebe der Satz stehen und mit ihm die Abhilfe verschwunden, die
    // für die neue Größe sehr wohl eine Nummer hätte.
    effect(() => {
      this.ringSize();
      this.keineFreieNummer.set(false);
    });

    // Issue #19: a 'ring_destroyed' record ("Ring Vernichtet") carries no bird
    // data, so the bird-field validators must step aside or the collapsed form
    // could never be submitted. Ringnummer/Ringgröße stay required.
    effect(() => {
      const ringDestroyed = this.isRingDestroyed();
      for (const name of ['bird_status', 'age_class', 'sex']) {
        const control = this.entryForm.get(name)!;
        control.setValidators(ringDestroyed ? [] : [Validators.required]);
        control.updateValueAndValidity({ emitEvent: false });
      }
    });

    // Issue #57 / #371: the Bemerkung becomes mandatory whenever the unusual
    // catch must always be described — an 'unknown_species' capture ("Aves
    // ignota", ADR 0004) or either Fangmarker (Tot-Fund / Nicht-Standard-Fang,
    // ADR 0026). Mirrors the sentinel validator-toggling above; the serializer
    // enforces the same rule server-side.
    effect(() => {
      const required =
        this.isUnknownSpecies() || this.isDeadRecovery() || this.isNonStandard();
      const control = this.entryForm.get('comment')!;
      control.setValidators(required ? [Validators.required] : []);
      control.updateValueAndValidity({ emitEvent: false });
    });

    // #371: a Ring-vernichtet capture has no bird to mark, so both Fangmarker are
    // forced off while it is active (their buttons are also hidden in the
    // template). Mirrors the server-side force-off in the capture service.
    effect(() => {
      if (!this.isRingDestroyed()) {
        return;
      }
      for (const name of ['is_dead_recovery', 'is_non_standard']) {
        const control = this.entryForm.get(name)!;
        if (control.value) {
          control.setValue(false);
        }
      }
    });

    // #26: only the Kleingefieder Fortschritt (small_feather_app, J/U/M/N) is
    // tied to the age class — it records the post-juvenile moult that only a
    // diesjähriger Vogel (Alter = 3) undergoes, so for every other age class it
    // is cleared and disabled (greyed out but still visible). The Intensität
    // (small_feather_int) and the Handschwingenmauser stay enabled for all ages
    // and are deliberately left untouched here. Clearing matters: the export
    // reads getRawValue(), which includes disabled controls, so a stale value
    // would otherwise leak through.
    effect(() => {
      const control = this.entryForm.get('small_feather_app')!;
      if (this.isDiesjaehrig()) {
        control.enable({ emitEvent: false });
      } else {
        control.setValue(null, { emitEvent: false });
        control.disable({ emitEvent: false });
      }
    });

    // #336/#430: a control the Projekt switched off is disabled so keyboard nav
    // skips it (focusNext already skips disabled fields) and the hidden input is
    // inert. The values are NOT cleared: getRawValue() includes disabled controls,
    // so editing an existing capture whose Projekt hides a field re-saves its stored
    // value untouched — switching a field off is display-only and deletes nothing
    // (ADR 0035).
    effect(() => {
      const hidden = this.hiddenOptionalControls();
      for (const names of Object.values(DataEntryFormComponent.OPTIONAL_FIELD_CONTROLS)) {
        for (const name of names) {
          const control = this.entryForm.get(name)!;
          if (hidden.has(name)) {
            if (!control.disabled) {
              control.disable({ emitEvent: false });
            }
          } else if (control.disabled) {
            control.enable({ emitEvent: false });
          }
        }
      }
    });

    // #232: the Zentrale field's editability is decided by Status. A Wiederfang
    // can carry a ring from a foreign Zentrale, so its Zentrale is enabled and
    // searchable; an Erstfang or a Ring-vernichtet record always draws the
    // Projekt-Zentrale, so the field is disabled and forced to it. This is what
    // makes the Zentrale NON-sticky: flipping Status back to Erstfang (or
    // selecting Ring vernichtet) resets it to the Projekt default. The current
    // value is read imperatively (not via a signal) so forcing it never feeds
    // back into this effect.
    effect(() => {
      const editable = this.isRecatch() && !this.isRingDestroyed();
      const control = this.entryForm.get('central')!;
      if (editable) {
        if (control.disabled) {
          control.enable({ emitEvent: false });
        }
        return;
      }
      const current = control.value as Central | null;
      const isProjektZentrale =
        !!current && typeof current === 'object' && current.scheme_code === AUW_SCHEME_CODE;
      if (!isProjektZentrale) {
        control.setValue(PROJEKT_ZENTRALE);
      }
      control.disable({ emitEvent: false });
    });

    // #232: a ring from a foreign Zentrale uses that scheme's own size codes and
    // may carry letters in its number, so the strict Austrian Ringgröße dropdown
    // becomes a free-text field and the Ringnummer drops its numeric-only pattern.
    // Returning to the Projekt-Zentrale restores the strict dropdown, clearing a
    // value that is not a valid Austrian code (a foreign free-text Größe) so the
    // dropdown never opens on an unlisted value.
    effect(() => {
      const foreign = this.isForeignCentral();
      const ringNumber = this.entryForm.get('ring_number')!;
      const ringSize = this.entryForm.get('ring_size')!;
      if (foreign) {
        ringNumber.setValidators([Validators.required]);
      } else {
        ringNumber.setValidators([Validators.required, Validators.pattern('^[0-9]*$')]);
        const size = ringSize.value as string | null;
        if (size && !AUSTRIAN_RING_SIZES.has(size)) {
          ringSize.setValue(null);
        }
      }
      ringNumber.updateValueAndValidity({ emitEvent: false });
    });

    effect(() => {
      const id = this.entryId();
      if (!id) {
        return;
      }

      // Issue #163: entry-detail navigation resolves both server IDs and
      // local outbox IDs to the same form. `findQueued()` is a synchronous,
      // already-account-scoped read of `OutboxService`'s in-memory state —
      // safe here because the only way to reach /data-entry/:id with a
      // queued id is via "today's session" (issue #163), whose own list
      // already awaited `OutboxService.ready` to render, so the outbox is
      // guaranteed populated by the time this component is ever constructed
      // with such an id. A server id (never queued) simply falls through to
      // the unchanged server fetch below.
      const queued = this.outbox.findQueued(id);
      if (queued) {
        this.loadedQueuedEntry.set(queued);
        void this.loadQueuedEntryForEdit(queued);
        return;
      }

      this.loadEntryFromServer(id);
    });

    // #338: left/right arrow field-jump must be intercepted in the CAPTURE phase,
    // on the component host (an ancestor of every field), so it runs *before* any
    // element-level keydown listener at the event target. This matters for a
    // closed <mat-select>: Material's own (keydown) handler routes a horizontal
    // arrow to its key manager, whose change subscription calls
    // `_selectViaInteraction()` and silently advances the selected value. A
    // bubble-phase handler (the host `(keydown)` binding) fires too late — the
    // value has already changed and preventDefault cannot undo a programmatic
    // selection. Handling the gesture in capture lets onArrowNav stop the event
    // (stopImmediatePropagation) before Material ever sees it, so the jump moves
    // focus without mutating the field it leaves.
    const host = this.elementRef.nativeElement;
    const captureArrowNav = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        this.onArrowNav(event);
      }
    };
    host.addEventListener('keydown', captureArrowNav, true);
    this.destroyRef.onDestroy(() => host.removeEventListener('keydown', captureArrowNav, true));
  }

  /**
   * Das GET hinter `/data-entry/:id`.
   *
   * #385: der Fehlerzweig ist hier nicht optional. Ohne ihn blieb `loading`
   * nach einem gescheiterten GET für immer stehen — ein dauerhafter Spinner
   * über einem leeren Formular: Speichern blieb über `entryForm.invalid ||
   * loading()` deaktiviert, die unberührten Pflichtvalidatoren ließen
   * `onSubmit()` früh zurückkehren (auch Strg+S war also tot), und nichts sagte,
   * was passiert war.
   *
   * #446: eine eigene Methode, weil „Erneut laden" genau hierher zurückkommt.
   */
  private loadEntryFromServer(id: string): void {
    this.loading.set(true);
    this.loadFailure.set(null);
    this.apiService.getDataEntry(id).subscribe({
      next: entry => {
        this.loadedEntry.set(entry);
        this.entryForm.patchValue(this.transformToForm(entry));
        // #273: seed the "last searched ring" key so leaving the Ringnummer on a
        // saved Wiederfang does not silently re-fetch and clobber edits. A
        // changed Ringnummer still differs from this key and triggers a lookup.
        this.lastSearchedRingKey = this.ringLookupKey();
        // Issue #19/#57: a loaded Sonderart entry must apply the same
        // collapse / mandatory-comment behaviour as a freshly selected one.
        this.selectedSpecies.set(entry.species ?? null);
        this.loading.set(false);
        // PRD #261 (#267): surface the quiet suffix icons for any stored value
        // already out of range, without a modal (the norm may still be loading;
        // loadNorms re-seeds once it lands).
        this.seedPlausibilityOnLoad();
      },
      error: (err: unknown) => {
        this.loadFailure.set(appFailureOf(err));
        this.loading.set(false);
      },
    });
  }

  /**
   * „Erneut laden" aus dem In-Place-Fehlerzustand (#446) — der Ausweg der
   * Klasse *Erneut versuchen* an Ort und Stelle, ohne den Bildschirm zu
   * verlassen und erneut anzusteuern. Der eingereihte Pfad kommt hier nie an:
   * er liest lokalen Zustand und kann so gar nicht scheitern.
   */
  onReloadEntry(): void {
    const id = this.entryId();
    if (id) {
      this.loadEntryFromServer(id);
    }
  }

  /**
   * Loads a queued (nicht synchronisiert) outbox entry into the form for
   * editing (issue #163). The outbox only ever stores the flat write-shape
   * payload (`species_id`/`ringing_station_id`/`staff_id`, exactly what a
   * create POSTs) — never the nested records the form controls hold — so
   * this resolves them from the already-cached offline reference bundle
   * (issue #158) via `resolveQueuedEntryDisplay`, the same lookup "today's
   * session" uses to render the queue. An id no longer resolvable in the
   * cache (e.g. a species removed from the pool since) is left `null`,
   * surfacing as an empty, reselectable field rather than blocking the edit.
   */
  private async loadQueuedEntryForEdit(entry: OutboxEntry): Promise<void> {
    this.loading.set(true);
    let bundle = null;
    try {
      bundle = (await this.referenceCache.load())?.bundle ?? null;
    } catch (error) {
      console.error('Failed to read the offline reference cache', error);
    }
    const display = resolveQueuedEntryDisplay(entry.payload, bundle);
    const formValue: Record<string, unknown> = {
      ...entry.payload,
      species: display.species,
      ringing_station: display.ringingStation,
      staff: display.staff,
    };
    delete formValue['species_id'];
    delete formValue['ringing_station_id'];
    delete formValue['staff_id'];
    delete formValue['idempotency_key'];
    delete formValue['project_id'];
    // #232/#163: the outbox stores a foreign Zentrale only as its bare scheme
    // code; resolve it back to a Central object (like species/Station/Beringer)
    // so isForeignCentral() — which requires an object — sees it. Otherwise the
    // free-text Ringgröße never shows, the ring-size effect wipes the stored
    // foreign size as a non-Austrian value, and the raw string trips
    // selectedOptionValidator, blocking re-save. A domestic capture omits
    // `central`, so drop the key and keep the form's Projekt-Zentrale default.
    if (display.central) {
      formValue['central'] = display.central;
    } else {
      delete formValue['central'];
    }

    this.loadedQueuedFormValue.set(formValue);
    this.entryForm.patchValue(formValue);
    // #273: seed the "last searched ring" key (as the server-load path does) so
    // leaving the Ringnummer on an opened queued Wiederfang does not re-fetch.
    this.lastSearchedRingKey = this.ringLookupKey();
    // Issue #19/#57: a loaded Sonderart entry must apply the same collapse /
    // mandatory-comment behaviour as a freshly selected one.
    this.selectedSpecies.set(display.species);
    this.loading.set(false);
    // PRD #261 (#267): reveal the quiet suffix icons for any queued stored value
    // already out of range, without a modal (same load-path behaviour as a synced
    // record).
    this.seedPlausibilityOnLoad();
  }

  ngOnInit(): void {
    const project = this.currentProject();
    if (!project && !this.isEditMode()) {
      this.router.navigateByUrl('/');
      return;
    }

    // Pre-fill the Station from the Projekt default in create mode. It is a
    // starting value, not a lock: only set it while empty so a manual change
    // within the session (preserved by clearForm) is never reset by the default.
    const stationControl = this.entryForm.get('ringing_station')!;
    if (!this.isEditMode() && project?.default_station && !stationControl.value) {
      stationControl.setValue(project.default_station);
    }

    // Autocomplete setup (no changes needed)
    this.filteredSpecies = this.entryForm.get('species')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      map(value => (typeof value === 'string' ? value : value?.common_name_de ?? '')),
      distinctUntilChanged(),
      switchMap(name => this.dataAccess.getSpecies(name, this.currentProject()?.id).pipe(map(response => response.results)))
    );

    this.filteredStations = this.entryForm.get('ringing_station')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      map(value => (typeof value === 'string' ? value : value?.name ?? '')),
      distinctUntilChanged(),
      switchMap(name => this.dataAccess.getRingingStations(name, this.currentProject()?.organization.handle).pipe(map(response => response.results)))
    );

    this.filteredScientists = this.entryForm.get('staff')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      map(value => (typeof value === 'string' ? value : value?.full_name ?? '')),
      distinctUntilChanged(),
      tap(term => this.staffSearchTerm.set(term)),
      switchMap(name => this.dataAccess.getScientists(name).pipe(map(response => response.results))),
      tap(results => this.staffResults.set(results)),
    );

    // #232/#233: the Zentrale autocomplete for an ausländischer Wiederfang, fed
    // by the /centrals/ lookup (one `search` param matches name/country/scheme
    // code), following the species/Station pattern above. Routed through the
    // offline-aware facade (#233): online it hits the server unchanged, while
    // offline it searches the cached Zentralen register the bundle carries — the
    // same searchable UX with no network.
    this.filteredCentrals = this.entryForm.get('central')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      map(value => (typeof value === 'string' ? value : value?.name ?? '')),
      distinctUntilChanged(),
      switchMap(name => this.dataAccess.getCentrals(name).pipe(map(response => response.results))),
    );

    this.prefillRememberedBeringer();

    // Issue #19/#57, #427: load the "Ring Vernichtet" Art so the quick-button can
    // apply it in one click — ASKED FOR at the special_kind discriminator, not
    // hoped for on the usage-sorted first page of the unfiltered species list
    // (where a rare Sonderart practically never appears, which left the button
    // silently inert online). The same call offline filters the cached species
    // pool by that identical key, so both paths resolve the same row.
    this.dataAccess.getSpecies('', this.currentProject()?.id, 'ring_destroyed').subscribe({
      next: response => {
        this.ringDestroyedSpecies.set(
          response.results.find(s => s.special_kind === 'ring_destroyed') ?? null,
        );
      },
      // A failed lookup leaves the Sonderart unresolved; the click says so out
      // loud rather than doing nothing (see onDestroyedRing).
      error: () => this.ringDestroyedSpecies.set(null),
    });

    // PRD #245: load the per-org Artennormen from the offline reference bundle
    // so the plausibility lookup works the same online and offline.
    void this.loadNorms();
  }

  // #338: autofocus Art on the very first open of a create-mode form, so the
  // Beringer can type the species straight away without clicking. Edit mode
  // (reviewing an existing record) is left untouched — it must never steal
  // focus onto Art. This complements the save-reset path, which already focuses
  // Art after each capture; here it closes the gap on the first capture of a
  // session. Runs after the view renders so the input exists in the DOM.
  ngAfterViewInit(): void {
    if (!this.isEditMode()) {
      this.focusField('species');
    }
  }

  // PRD #245: build the species_id → effective-Artennorm map from the cached
  // offline reference bundle (issue #158). A bundle cached by a pre-feature app
  // version carries no `norms` — treated as an empty map, so no check fires.
  private async loadNorms(): Promise<void> {
    try {
      const bundle = (await this.referenceCache.load())?.bundle ?? null;
      const map: Record<string, SpeciesNorm> = {};
      for (const norm of bundle?.norms ?? []) {
        map[norm.species_id] = norm;
      }
      this.normsBySpecies.set(map);
      // PRD #261 (#267): in edit mode the Artennorm may land AFTER the record, so
      // re-seed the load-time icons now that the norm is available — still no modal.
      if (this.isEditMode()) {
        this.seedPlausibilityOnLoad();
      }
    } catch (error) {
      console.error('Failed to read Artennormen from the offline reference cache', error);
    }
  }

  // Issue #10: in create mode, pre-fill the Beringer with the one last used on
  // the active Projekt, so the field only needs touching when the ringer changes.
  private prefillRememberedBeringer(): void {
    const project = this.currentProject();
    if (!project || this.isEditMode()) {
      return;
    }
    const remembered = this.storage.loadLastBeringer(project.id);
    if (remembered) {
      this.entryForm.get('staff')!.setValue(remembered);
    }
  }

  // Issue #10: remember this Projekt's Beringer after each successful save so it
  // survives a reload and pre-fills next time.
  private rememberBeringer(): void {
    const project = this.currentProject();
    const staff = this.entryForm.get('staff')!.value;
    if (project && staff) {
      this.storage.saveLastBeringer(project.id, staff);
    }
  }

  onCreateBeringer(handle: string): void {
    const ref = this.dialog.open<
      BeringerCreateDialogComponent,
      {handle: string},
      BeringerCreateDialogResult
    >(BeringerCreateDialogComponent, {data: {handle}, width: '480px'});

    ref.afterClosed().subscribe(result => {
      if (!result) {
        return;
      }
      // Issue #167: route through the offline-aware facade — online it POSTs the
      // Beringer exactly as before; offline it durably queues a placeholder and
      // hands it back so it is selectable in this same session's captures at
      // once. Sync then creates the queued Beringer before its dependent
      // captures (Kürzel-matched), which resolve to the real id.
      this.dataAccess.createScientist(result).subscribe({
        next: created => {
          this.entryForm.get('staff')?.setValue(created);
          this.snackBar.open(
            `Beringer "${created.full_name} (${created.handle})" wurde angelegt.`,
            undefined,
            {duration: 2000},
          );
          this.focusNext('staff');
        },
        error: (err: unknown) => {
          // #443: eine ausgelöste Schreibung, die scheitert, landet im Banner
          // und bleibt dort — nicht in einer Snackbar, die vor der Antwort auf
          // die Frage „warum?" wieder weg ist.
          this.showFailure(appFailureOf(err), () => this.onCreateBeringer(handle));
        },
      });
    });
  }

  // Issue #19: the discreet quick-button near the Ringnummer field. It confirms
  // the rare destroyed-ring case before collapsing the form to the essentials.
  onDestroyedRing(): void {
    const ringDestroyed = this.ringDestroyedSpecies();
    if (!ringDestroyed) {
      // #427: ein Knopf, der wortlos nichts tut, ist genau der Defekt hier.
      // Lässt sich die Sonderart nicht auflösen, sagt der Klick das sichtbar.
      // #443: sichtbar heißt bleibend, und die Klasse ist *Unbekannt* — die
      // Referenzdaten fehlen, das liegt nie an der Eingabe.
      this.showFailure(
        localFailure(
          Fehlerklasse.Unbekannt,
          'Die Sonderart „Ring vernichtet" ist gerade nicht verfügbar — bitte die Seite neu laden.',
        ),
        () => this.onDestroyedRing(),
      );
      return;
    }
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Ring als vernichtet erfassen?',
          message:
            'Dieser Datensatz hält nur Ringnummer und Bemerkung fest — alle Vogel-Messwerte entfallen.',
          confirmLabel: 'Ring vernichtet',
          cancelLabel: 'Abbrechen',
        },
        width: '420px',
      },
    );
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.setByUser('species', ringDestroyed);
        this.selectedSpecies.set(ringDestroyed);
      }
    });
  }

  // #371 (ADR 0026): the Tot-Fund toggle. Clicking it while unset opens the
  // Todesumstände popup — pre-filled by parsing the Bemerkung when a stored
  // Tot-Fund is edited — and, on confirm, marks the capture and composes the
  // Bemerkung `Totfund; Umstände: <Eingabe>` (mandatory). Cancelling leaves the
  // capture un-marked. Clicking it again toggles the marker off to undo a
  // mis-click, clearing the auto-composed Bemerkung. The real Art and Ring stay.
  onToggleDeadRecovery(): void {
    if (this.isDeadRecovery()) {
      this.setByUser('is_dead_recovery', false);
      if (this.isTotfundComment(this.entryForm.get('comment')!.value)) {
        this.setByUser('comment', null);
      }
      return;
    }
    const ref = this.dialog.open<TotFundDialogComponent, TotFundDialogData, string>(
      TotFundDialogComponent,
      {
        data: { umstaende: this.parseTotfundUmstaende(this.entryForm.get('comment')!.value) },
        width: '460px',
      },
    );
    ref.afterClosed().subscribe(umstaende => {
      // Cancel (undefined) leaves the capture un-marked; a blank string cannot
      // occur (the dialog requires the Todesumstände).
      if (umstaende === undefined || umstaende === null) {
        return;
      }
      this.setByUser('comment', this.composeTotfundComment(umstaende));
      this.setByUser('is_dead_recovery', true);
    });
  }

  // #371 (ADR 0026): the Nicht-Standard-Fang toggle. No popup and no auto-text —
  // it simply flips the marker, which makes the Bemerkung mandatory (with a hint)
  // and outlines the form with a coloured frame + badge. Toggles off to undo.
  onToggleNonStandard(): void {
    this.setByUser('is_non_standard', !this.entryForm.get('is_non_standard')!.value);
  }

  /**
   * Writes a value the Beringer chose himself (#407, ADR 0032).
   *
   * Reactive forms only set `dirty` when a **ControlValueAccessor** writes a
   * control — i.e. when the value came through the rendered input. A plain
   * `setValue()` leaves the form pristine, however deliberate the action behind
   * it. That is fine for the programmatic writes (a suggested Ringnummer, the
   * Kleingefieder fields cleared by the Alter, the Station pre-filled from the
   * Projekt): the Beringer did not type those, and marking them would make an
   * untouched form claim it had unsaved input.
   *
   * But several genuinely human actions go through `setValue()` too — above all
   * the single-key categorical picks, which are how this form is actually
   * filled in. Those must dirty the form, because `entryForm.dirty` is now what
   * the CanDeactivate guard and "Jetzt aktualisieren" ask before throwing the
   * input away. A false "pristine" here is a bird's measurements lost with no
   * question asked.
   */
  private setByUser(controlName: string, value: unknown): void {
    const control = this.entryForm.get(controlName)!;
    control.setValue(value);
    control.markAsDirty();
  }

  private composeTotfundComment(umstaende: string): string {
    return `${DataEntryFormComponent.TOTFUND_PREFIX}${umstaende}`;
  }

  private isTotfundComment(comment: string | null | undefined): boolean {
    return !!comment && comment.startsWith(DataEntryFormComponent.TOTFUND_PREFIX);
  }

  // Parse the Todesumstände back out of a composed Bemerkung so editing a stored
  // Tot-Fund reopens the popup pre-filled. A comment that is not a composed
  // Totfund string yields an empty prefill.
  private parseTotfundUmstaende(comment: string | null | undefined): string {
    return this.isTotfundComment(comment)
      ? comment!.slice(DataEntryFormComponent.TOTFUND_PREFIX.length)
      : '';
  }

  // #25: an off-recommendation ring size must be a deliberate choice. When the
  // Beringer picks a size that differs from the species' *existing* Empfohlene
  // Ringgröße, confirm it immediately on selection — not at save time. Species
  // with no recommendation (including the sex-dimorphic NULL species) are freely
  // selectable with no prompt. Cancelling reverts to the recommended size.
  //
  // Only user-initiated selections reach this handler: the auto-fill on species
  // selection uses setValue(), which does not emit MatSelect.selectionChange.
  onRingSizeSelected(event: MatSelectChange): void {
    const recommended = this.selectedSpecies()?.ring_size ?? null;
    const chosen = event.value as RingSize;
    if (!recommended || chosen === recommended) {
      return;
    }
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Von empfohlener Ringgröße abweichen?',
          message: `Für diese Art ist Ringgröße ${recommended} empfohlen. Möchtest du wirklich die abweichende Größe ${chosen} verwenden?`,
          confirmLabel: 'Größe übernehmen',
          cancelLabel: 'Abbrechen',
        },
        width: '420px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        this.entryForm.get('ring_size')?.setValue(recommended);
      }
    });
  }

  onSpeciesSelected(event: MatAutocompleteSelectedEvent): void {
    const species: Species = event.option.value;
    this.selectedSpecies.set(species ?? null);
    // #232: while a foreign Zentrale is selected the Ringgröße is free text, so
    // the species' Empfohlene Ringgröße prefill is suppressed — it only applies
    // to the strict Austrian dropdown.
    if (species && species.ring_size && !this.isForeignCentral()) {
      this.entryForm.get('ring_size')?.setValue(species.ring_size);
    }
    // PRD #245/#261 (#265/#266): the effective Artennorm changes with the Art, so
    // wipe the acknowledged de-dup state — numeric AND categorical (the norm
    // changed → re-evaluate everything) — and re-check every field against the
    // newly selected Art's norm, aggregating every value now implausible into ONE
    // „Verstanden" modal.
    this.acknowledgedSignatures.set(resetAcknowledgedSignatures());
    this.evaluatePlausibility();
    this.onAutocompleteAccepted('species', event);
  }

  // #23: accepting an autocomplete option (via Enter or click) advances focus to
  // the next field, keeping the keyboard workflow moving. The inline "neuer
  // Beringer" option carries a null value and must not advance — its own flow
  // handles focus once the dialog closes.
  onAutocompleteAccepted(controlName: string, event: MatAutocompleteSelectedEvent): void {
    if (event.option.value) {
      this.focusNext(controlName);
    }
  }

  displaySpecies(species: Species): string {
    return species ? species.common_name_de : '';
  }

  displayStation(station: RingingStation): string {
    return station ? station.name : '';
  }

  displayScientist(scientist: Scientist): string {
    return scientist ? `${scientist.full_name} (${scientist.handle})` : '';
  }

  // #232: the Zentrale autocomplete shows the scheme's name; the option list also
  // surfaces the country and scheme code so a foreign Zentrale is searchable by
  // any of the three.
  displayCentral(central: Central): string {
    return central ? central.name : '';
  }

  // #273: the ring (Ringgröße + Ringnummer) the auto-search last ran for. The
  // implicit blur path is idempotent against it; Enter and the button ignore it
  // and always fire (deliberate re-search).
  private lastSearchedRingKey: string | null = null;

  // #273: the magnifying-glass search control folded into the Ringnummer field.
  // A blur whose focus lands on it is the button's own click about to run the
  // lookup, so the blur path stands down and lets the click own it.
  private readonly ringSearchButton = viewChild('ringSearchButton', { read: ElementRef });

  // #404: the ring number a lookup actually searches for — the field's value
  // stripped of surrounding whitespace. Only the ends: an inner space belongs to
  // the number itself (a foreign Zentrale's "AB 1234" is stored that way, and
  // stripping every space would search "AB1234" and never find it).
  private trimmedRingNumber(): string {
    const ringNumber = this.entryForm.get('ring_number')?.value;
    return typeof ringNumber === 'string' ? ringNumber.trim() : String(ringNumber ?? '');
  }

  // #404: keyed on the TRIMMED number so that padding a ring the auto-search
  // already ran for ("901234" → "901234 ") stays recognisable as that same ring
  // and the blur path stands down. Keyed raw, the padded value would miss the
  // recorded key and refetch a ring whose history is already on screen.
  private ringLookupKey(): string {
    const ringSize = this.entryForm.get('ring_size')?.value ?? '';
    return `${ringSize}::${this.trimmedRingNumber()}`;
  }

  // #273: leaving the Ringnummer field auto-runs the ring-history lookup — the
  // Beringer's first move on a Wiederfang — without an extra Enter/click. Only
  // on a Wiederfang; an Erstfang blur does nothing. Idempotent: a ring already
  // searched (via blur, Enter or the button) is not looked up again on blur.
  onRingNumberBlur(event: FocusEvent): void {
    if (!this.isRecatch()) {
      return;
    }
    // Focus moving onto the search button is its click about to fire the lookup;
    // let the click own it so the button never double-fetches.
    if (event.relatedTarget && event.relatedTarget === this.ringSearchButton()?.nativeElement) {
      return;
    }
    if (this.ringLookupKey() === this.lastSearchedRingKey) {
      return;
    }
    this.fetchRingHistory();
  }

  fetchRingHistory(): void {
    const ringSize = this.entryForm.get('ring_size')?.value;
    // #404: search the TRIMMED ring. DRF trims on write (trim_whitespace=True),
    // so a pasted " 901234 " is stored as "901234" — searching the raw value
    // found nothing and told the Beringer the bird was unknown while it sat in
    // the database. All three triggers (blur, Enter, the magnifier button) route
    // through here, so this one trim covers every route into the lookup.
    const ringNumber = this.trimmedRingNumber();
    if (!ringSize || !ringNumber) {
      return;
    }
    // #404: show the Beringer the clean value that was actually searched. Written
    // back before the key is recorded, so both describe the same ring.
    if (this.entryForm.get('ring_number')?.value !== ringNumber) {
      this.entryForm.get('ring_number')?.setValue(ringNumber);
    }
    // #273: record the searched ring so a later blur on the same ring is a no-op.
    this.lastSearchedRingKey = this.ringLookupKey();
    this.loading.set(true);
    // Issue #168: route through the offline-aware facade so the lookup keeps
    // working at a Station with no reception — it attempts the real server
    // read first (identical to before) and only falls back to a locally
    // assembled history (queued + cached captures) on a connectivity failure.
    this.dataAccess.getRingHistory(ringSize, ringNumber).subscribe({
      next: ({entries, possiblyIncomplete}) => {
        this.historyPossiblyIncomplete.set(possiblyIncomplete);
        if (entries.length > 0) {
          this.recaptureHistory.set(entries);
          this.prefillFromPriorCatch(entries);
          this.snackBar.open(`${entries.length} frühere Einträge für diesen Ring gefunden.`, 'Schließen', {duration: 3000});
        } else {
          this.recaptureHistory.set([]);
          // Non-blocking: a bird ringed outside the app can still be recorded.
          // Offline, "found nothing" only means "nothing known locally", so
          // the message says so rather than implying a definitive answer.
          this.snackBar.open(
            possiblyIncomplete
              ? 'Offline: keine lokal gespeicherten Einträge für diesen Ring auf diesem Gerät.'
              : 'Keine früheren Einträge für diesen Ring gefunden.',
            'Schließen',
            {duration: 3000},
          );
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        // #443: auch ein gescheitertes Laden verfällt nicht mehr nach drei
        // Sekunden — die Ringhistorie einfach leer zu lassen ist genau der
        // „kaputt sieht aus wie leer"-Defekt, den dieses PRD abräumt. „Erneut
        // versuchen" wiederholt die Suche. (#446 stellt den Ladefehler später
        // an Ort und Stelle, sobald es dafür ein Bauteil gibt.)
        this.showFailure(appFailureOf(err), () => this.fetchRingHistory());
      }
    });
  }


  // #23: identify the bird from its ring history. Art + Geschlecht carry over
  // from the most recent prior catch; age changes between catches and every
  // measurement is taken afresh, so those are deliberately left empty.
  private prefillFromPriorCatch(history: DataEntry[]): void {
    const mostRecent = history.reduce((latest, entry) =>
      entry.date_time > latest.date_time ? entry : latest,
    );
    this.entryForm.patchValue({
      species: mostRecent.species ?? null,
      sex: mostRecent.sex ?? null,
    });
    this.selectedSpecies.set(mostRecent.species ?? null);
  }


  openDetailDialog(entry: DataEntry): void {
    this.dialog.open(DataEntryDetailDialogComponent, {
      data: entry,
      width: '640px',
      maxHeight: '90vh',
    });
  }

  // #24: the Zurücksetzen button. An empty/pristine form resets straight away; a
  // dirty form first asks for confirmation so unsaved work is never lost silently.
  onReset(): void {
    if (!this.entryForm.dirty) {
      this.performReset();
      return;
    }
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Eingaben zurücksetzen?',
          message: this.isEditMode()
            ? 'Es gibt ungespeicherte Änderungen. Möchtest du die gespeicherten Werte wiederherstellen?'
            : 'Es gibt ungespeicherte Änderungen. Möchtest du das Formular wirklich zurücksetzen?',
          confirmLabel: 'Zurücksetzen',
          cancelLabel: 'Weiter bearbeiten',
        },
        width: '420px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.performReset();
      }
    });
  }

  // #24: in edit mode Zurücksetzen restores the record's saved values (discarding
  // the user's changes); in create mode it runs the shared clean-reset.
  private performReset(): void {
    if (this.isEditMode()) {
      this.resetToSaved();
    } else {
      this.cleanReset();
    }
  }

  // #24: leave the list-bound back navigation in edit mode so an opened record can
  // be left without saving, separate from Zurücksetzen. Issue #163: a queued
  // entry was opened from "today's session", so it returns there instead of
  // the synced-only "Letzte Fänge" list.
  onBackToList(): void {
    this.router.navigateByUrl(this.isQueuedEditMode() ? '/heute' : '/data-entries');
  }

  // #392 (ADR 0030): „Eintrag löschen" aus der Erfassungsmaske. „Löschen" ist das
  // einzige Wort an der Oberfläche — dass die Zeile hinter einem Flag erhalten
  // bleibt, ist eine Implementierungsentscheidung und für die Nutzerin unsichtbar.
  // Die Bestätigung ist bewusst dieselbe wie auf der Heute-Seite.
  onDeleteEntry(): void {
    const id = this.entryId();
    if (!id) {
      return;
    }
    // Ein eingereihter Eintrag hat nur eine lokal vergebene Outbox-ID (sie reist
    // als `idempotency_key` mit) — der Server kennt sie nicht, ein DELETE darauf
    // wäre immer ein 404. Die Vorlage blendet den Knopf hier bereits aus; diese
    // Sperre hält die Zusage auch dann, wenn die Methode anders aufgerufen wird.
    if (this.isQueuedEditMode()) {
      return;
    }
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Eintrag löschen?',
          message: 'Der Eintrag wird gelöscht. Du kannst das direkt danach rückgängig machen.',
          confirmLabel: 'Löschen',
          cancelLabel: 'Abbrechen',
        },
        width: '420px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.apiService.deleteDataEntry(id).subscribe({
        next: () => {
          // #407: the record is gone — there is nothing left to save, so the
          // CanDeactivate guard must not ask about the open form on the way out.
          this.entryForm.markAsPristine();
          this.router.navigateByUrl('/data-entries');
          this.offerUndo(id);
        },
        error: (err: unknown) => {
          console.error('Error deleting data entry', err);
          // #443: das Löschen ist eine ausgelöste Schreibung — scheitert sie,
          // sagt das Banner warum, und der Eintrag steht unversehrt da.
          this.showFailure(appFailureOf(err), () => this.onDeleteEntry());
        },
      });
    });
  }

  // #392 (ADR 0030): das „Rückgängig"-Fenster — die einzige Wiederherstellung, die
  // es gibt (kein Papierkorb). Bewusst NICHT an den DestroyRef der Komponente
  // gehängt: der Klick auf „Löschen" navigiert weg und zerstört sie, ein
  // takeUntilDestroyed() würde also genau das Undo abräumen, für das das Snackbar
  // da ist. Läuft das Fenster ab oder wird das Snackbar weggewischt, bleibt der
  // Eintrag gelöscht — Nichtstun ist hier die richtige Antwort.
  private offerUndo(id: string): void {
    this.snackBar
      .open('Eintrag wurde gelöscht.', 'Rückgängig', {duration: 10000})
      .onAction()
      .subscribe(() => {
        this.apiService.restoreDataEntry(id).subscribe({
          next: () => {
            // Die Liste, auf die das Löschen navigiert hat, steht längst — sie
            // lädt nur beim Betreten und beim Projektwechsel. Ohne dieses Signal
            // meldet das Snackbar einen Erfolg, den der Bildschirm widerlegt.
            this.entryRefresh.request();
            this.snackBar.open('Eintrag wurde wiederhergestellt.', undefined, {duration: 3000});
          },
          error: (err) => {
            console.error('Error restoring data entry', err);
            // #443: die **einzige** verbliebene Fehlschlag-Snackbar dieses
            // Bildschirms, und sie kann hier nicht anders: das „Rückgängig"
            // fällt, nachdem „Löschen" längst zur Fangliste navigiert und diese
            // Komponente zerstört hat — ein Banner an dieser Stelle sähe
            // niemand. Sie gehört auf die Liste, und damit zu #448 („keine
            // Fehlschlag-Snackbar bleibt übrig", SPA-weit).
            this.snackBar.open('Eintrag konnte nicht wiederhergestellt werden.', 'Schließen', {
              duration: 3000,
            });
          },
        });
      });
  }

  // PRD #245: recompute the inline Plausibilitätswarnungen from the current form
  // values and the selected Art's effective norm. Bound to a measurement field's
  // blur, so the warning surfaces exactly when the value is finished — the same
  // non-modal role="alert" idiom the sex-contradiction hint rides. Also called
  // when the Art changes so a stale warning never lingers.
  onMeasurementBlur(controlName?: string): void {
    // #338: pass the blurred field through so that, if the check raises the
    // „Verstanden" modal, focus can return to this field once it is dismissed.
    // The blur already moved focus away, so the modal cannot restore it itself.
    this.evaluatePlausibility(controlName);
  }

  // Issue #249/#266: the two categorical-flag rules read the Alter, Geschlecht and
  // Handschwingenmauser selects, which settle on selectionChange rather than an
  // input blur — evaluate there so the flag Warnung raises its „Verstanden" modal
  // and marks its quiet suffix icon the moment the value is picked, mirroring the
  // numeric on-blur behaviour. (Alter carries no warning of its own but gates the
  // dj-Großgefiedermauser rule, whose icon lives on Handschwingenmauser.)
  onCategoricalChange(): void {
    this.evaluatePlausibility();
  }

  // PRD #261 (#265/#266): recompute the active Plausibilitätswarnungen (refreshing
  // the quiet suffix icons on every warnable field) and — routed through the „fire
  // once, never nag" de-dup — raise ONE aggregated „Verstanden" modal listing
  // every NEWLY-appeared warning, numeric (the six σ-band fields + the derived
  // Quotient) and categorical (Geschlecht, dj-Großgefiedermauser) alike. An
  // unchanged re-trigger stays silent; a value brought back into range clears
  // without a modal; a value settling into a new breach re-fires. One trigger
  // (e.g. an Art change) that trips several checks aggregates into a single modal.
  private evaluatePlausibility(triggerField?: string): void {
    const measurements = this.currentMeasurements();
    const warnings = computePlausibilityWarnings(measurements, this.activeNorm());
    this.plausibilityWarnings.set(warnings);
    const { toShow, nextAcknowledged } = reconcileAcknowledgedWarnings(
      this.acknowledgedSignatures(),
      warnings,
      computePlausibilitySignatures(measurements),
    );
    this.acknowledgedSignatures.set(nextAcknowledged);
    if (toShow.length > 0) {
      // PRD #361 (#363): bound to the SAME newly-appeared-warning event as the
      // „Verstanden" modal — one gentle „Pling" per new warning, silent on the
      // seed path, and muted/unavailable audio never blocks the modal below.
      this.sound.playWarning();
      this.openPlausibilityInfoDialog(toShow, triggerField);
    }
  }

  // PRD #261 (#267): the edit-mode LOAD path for the Plausibilitätsprüfung. Opening
  // an existing capture whose STORED values already breach the Artennorm must reveal
  // every flagged field's quiet suffix icon at once (they render off
  // suffixWarningByField ← plausibilityWarnings), yet raise NO „Verstanden" modal —
  // a warning present on load has no trigger event. So this only RECOMPUTES the
  // active Warnungen and seeds the „fire once, never nag" acknowledgment to a fresh
  // empty baseline; it deliberately does NOT run reconcileAcknowledgedWarnings, so no
  // dialog opens on load. The first real interaction — a numeric blur, a categorical
  // selectionChange, or an Art change — then runs the de-dup helper in
  // evaluatePlausibility and raises the still-active warnings once. Called from both
  // edit-load paths and from loadNorms (the record and its Artennorm load
  // independently — whichever settles last recomputes against a fully-loaded state).
  private seedPlausibilityOnLoad(): void {
    const warnings = computePlausibilityWarnings(this.currentMeasurements(), this.activeNorm());
    this.plausibilityWarnings.set(warnings);
    this.acknowledgedSignatures.set(resetAcknowledgedSignatures());
  }

  // PRD #261 (#263/#265/#266): the single-„Verstanden" informational modal for the
  // newly-appeared Plausibilitätswarnungen (numeric and categorical). One
  // aggregated dialog lists them all; the acknowledgment is transient (already
  // recorded in the signature set) and nothing is persisted.
  private openPlausibilityInfoDialog(warnings: PlausibilityWarning[], triggerField?: string): void {
    const ref = this.dialog.open<InfoDialogComponent, InfoDialogData, void>(InfoDialogComponent, {
      data: {
        title: 'Plausibilität prüfen',
        message:
          'Folgende Messwerte liegen außerhalb des erwarteten Bereichs:\n\n' +
          warnings.map((warning) => warning.message).join('\n'),
      },
      width: '480px',
    });
    // #338: on a blur-triggered warning the field already lost focus, so return
    // it once the ringer acknowledges the modal — a deliberate backward jump to
    // the checked field. (Optional chaining keeps unit-test dialog stubs safe.)
    if (triggerField) {
      ref?.afterClosed?.().subscribe(() => this.focusField(triggerField));
    }
  }

  // The measurement subset the Plausibilitätsprüfung reads, pulled from the raw
  // form value (getRawValue includes disabled controls). Shaped to match
  // PlausibilityMeasurements so #247/#248/#249 extend the check without touching
  // this call site.
  private currentMeasurements(): PlausibilityMeasurements {
    const v = this.entryForm.getRawValue();
    return {
      weight_gram: v.weight_gram,
      feather_span: v.feather_span,
      wing_span: v.wing_span,
      tarsus: v.tarsus,
      notch_f2: v.notch_f2,
      inner_foot: v.inner_foot,
      sex: v.sex,
      age_class: v.age_class,
      hand_wing: v.hand_wing,
    };
  }

  onSubmit(): void {
    // #443: NICHT `entryForm.invalid` — **dieselbe Frage, die der Knopf stellt**,
    // damit die beiden nie auseinanderlaufen. Eine Feldmarkierung macht ihr
    // Control ungültig; hörte dieses `return` darauf, wäre jede Speicherung
    // beendet, bis genau dieses eine Feld angefasst wird — obwohl das Banner
    // darüber „Bitte korrigieren und erneut speichern" sagt und ADR 0037 sich
    // darauf verlässt, dass eine Abhilfe das Formular füllt und das Mitglied
    // dann Speichern drückt.
    if (this.invalidBeyondServerRejection()) {
      Object.values(this.entryForm.controls).forEach(control => {
        if (control.invalid) {
          control.markAsTouched();
        }
      });
      this.focusFirstInvalid();
      return;
    }

    // Der Versuch geht wirklich hinaus: die Markierungen beantworteten den
    // vorigen und gehen mit ihm — wie das Banner, das `performSave()` zurücknimmt.
    this.clearServerRejections();

    // PRD #261 (#266): saving is never gated on a Plausibilitätswarnung. Every
    // trigger path — a numeric blur, a categorical selectionChange, and an Art
    // change — already raised the single-„Verstanden" InfoDialog the moment the
    // implausible value appeared (routed through the „fire once, never nag" de-dup),
    // so onSubmit opens NO plausibility dialog and writes/queues directly. The
    // save-time Bestätigung (the old ConfirmDialog gate) is gone.
    this.performSave();
  }

  private performSave(): void {
    this.loading.set(true);
    // #443: der neue Versuch beantwortet den alten — das Banner des letzten
    // Fehlschlags geht, bevor dieser hier eine Antwort hat.
    this.saveFailure.set(null);
    const rawValue = this.entryForm.getRawValue();

    // #155: only reuse the idempotency key across a resubmit when it replays the
    // exact same content as the last failed attempt (a true retry). An edited
    // resubmit must never risk the server treating it as the same create and
    // silently discarding the correction — mint a fresh key instead. A queued
    // edit (#163) never touches this key at all — it always keeps its own
    // outbox id, see transformFromForm().
    if (!this.isEditMode() && this.lastFailedSubmission !== null) {
      if (JSON.stringify(rawValue) !== this.lastFailedSubmission) {
        this.idempotencyKey = crypto.randomUUID();
      }
    }

    const formValue = this.transformFromForm(rawValue);

    // #160/#163: a create — including re-saving a queued (nicht
    // synchronisiert) entry, which is really "create, still pending" — routes
    // through the offline outbox. A brand-new create goes through the
    // offline-aware facade (attempts the real POST first, only durably
    // enqueues on a genuine connectivity failure); a queued edit writes
    // straight back into the outbox via `OutboxService.update()` — it was
    // never on the server to begin with, so there is nothing to PUT. An edit
    // of an already-*synced* record always targets the server: es gibt keinen
    // Offline-Rückfall dafür (offline edits of synced entries are out of scope
    // for PRD #152 — see its "Out of Scope" section) und keinen Rückfall auf
    // eine abgelaufene Sitzung (#447, ADR 0039 — ein Edit ändert nur, was der
    // Server bereits hält). Es geht trotzdem über die Fassade, weil dort die
    // Tabelle steht und weil der Edit die eine Markierung braucht, die er sehr
    // wohl verdient: sein 401 wird am Formular gemeldet, nicht mit einem Sprung
    // zur Anmeldung, der die Korrektur mitnähme.
    const saveOperation: Observable<unknown> = this.isQueuedEditMode()
      ? this.outbox.update(this.entryId()!, formValue as Record<string, unknown>)
      : this.isEditMode()
        ? this.dataAccess.updateDataEntry(this.entryId()!, formValue)
        : this.dataAccess.createDataEntry(formValue);

    saveOperation.subscribe({
      next: () => {
        this.rememberBeringer();
        this.lastFailedSubmission = null;
        // #407: what was in the form is now saved (or queued), so there is
        // nothing unsaved left. The edit paths below navigate away, and without
        // this the new CanDeactivate guard would ask the Beringer to confirm
        // discarding the very input he just saved. The create path resets to a
        // pristine form anyway (cleanReset).
        this.entryForm.markAsPristine();
        this.snackBar.open('Beringungseintrag gespeichert.', undefined, {
          duration: 2000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });
        if (this.isQueuedEditMode()) {
          // Issue #163: back to "today's session", where the re-queued entry
          // still shows as nicht synchronisiert.
          this.router.navigateByUrl('/heute');
          return;
        }
        if (this.isEditMode()) {
          // Edits return to the list hub; high-speed create flow stays put.
          this.router.navigateByUrl('/data-entries');
          return;
        }
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 900);
        this.cleanReset();
      },
      error: (err: unknown) => {
        console.error('Error saving data entry', err);
        // #447 (ADR 0039): eine abgelaufene Sitzung hat den Fang **nicht**
        // vernichtet — er liegt dauerhaft in der Outbox, genau wie bei einem
        // Netzausfall. Das Formular verhält sich deshalb wie nach einer
        // eingereihten Speicherung: der Fang ist erfasst, das Formular steht
        // frisch für den nächsten Vogel da, und der `unsavedChangesGuard` (#407)
        // hat nichts mehr zu verwerfen, wenn das Banner zur Anmeldung führt.
        // Der Fehlschlag bleibt trotzdem im Banner stehen — die Sitzung muss
        // erneuert werden, und erst danach überträgt sich der Eintrag.
        if (isDurablyQueued(err)) {
          this.rememberBeringer();
          this.entryForm.markAsPristine();
          this.cleanReset();
        } else if (!this.isEditMode()) {
          this.lastFailedSubmission = JSON.stringify(rawValue);
        }
        // #443 (ADR 0037): die Zurückweisung landet dort, wo die Geste
        // stattfand, und verfällt nicht — statt in einer Snackbar, die nach
        // drei Sekunden weg ist, während der Beringer beide Hände am Vogel hat.
        // Die Klasse kommt aus der gemeinsamen Einordnung; hier wird nie ein
        // Status gelesen und nie eine Meldung selbst gebaut.
        this.showFailure(appFailureOf(err), () => this.onSubmit());
        this.loading.set(false);
      },
      complete: () => this.loading.set(false)
    });
  }

  /**
   * #443 (ADR 0037): einen Fehlschlag zeigen — im Banner, und wo er an einem
   * Feld hängt, zusätzlich an diesem Feld.
   *
   * `retry` ist, was „Erneut versuchen" in *diesem* Moment bedeutet. Das Banner
   * weiß das nicht und soll es nicht wissen: es meldet nur den Wunsch nach oben.
   */
  private showFailure(failure: AppFailure, retry: () => void): void {
    this.saveFailure.set(failure);
    this.retryAction.set(retry);
    this.markRejectedField(failure);
    // Ein neuer Fehlschlag, eine neue Frage: was beim vorigen Mal keine freie
    // Nummer hergab, wird nicht als Antwort auf diesen ausgegeben.
    this.keineFreieNummer.set(false);
  }

  /** Der Ausweg „Erneut versuchen", so wie ihn dieser Fehlschlag gemeint hat. */
  onRetryFailure(): void {
    this.retryAction()?.();
  }

  /**
   * „Als Wiederfang erfassen" (#444, ADR 0037) — die erste der drei Abhilfen
   * einer bereits vergebenen Ringnummer: der Vogel trägt den Ring schon, also
   * ist das in Wahrheit ein Wiederfang.
   *
   * Sie setzt den **Ringstatus und sonst nichts** — insbesondere bleibt die
   * Ringnummer stehen, denn der Ring sitzt am Vogel. Und sie **speichert
   * nicht**: „Als Wiederfang" ändert die wissenschaftliche Aussage des
   * Datensatzes, und ein Fehlgriff meldete sonst einen Wiederfang für einen nie
   * zuvor gefangenen Vogel. Sichtbar, widerruflich, bewusst — drücken muss der
   * Beringer selbst.
   *
   * Die Feldmarkierung an der Ringnummer bleibt ebenfalls stehen: sie hält
   * fest, woran der Versuch scheiterte, und ist kein Hindernis — `onSubmit()`
   * räumt sie vor der Prüfung ab (#443).
   */
  onAlsWiederfang(): void {
    this.uebernehmen('bird_status', BirdStatus.ReCatch);
  }

  /**
   * „Die nächste freie Ringnummer übernehmen" (#444) — für den anderen Fall:
   * vorige Woche hat jemand eine Nummer vertippt, und dieser Vogel braucht
   * einfach die nächste.
   *
   * Gefragt wird der **bestehende** Endpunkt, den auch der Vorschlag der Maske
   * benutzt (#42/#22, im Zuschnitt des Projekts) — es gibt dafür keine zweite
   * Fläche. Das ist ein **Lesen**, keine Speicherung: der Griff zum Speichern
   * bleibt der des Beringers.
   *
   * Kommt keine Nummer — der Endpunkt kennt keine (`next_number: null`), es
   * fehlt die Ringgröße, oder das Lesen selbst scheitert —, dann sagt das
   * Banner genau das. Das Feld bleibt dabei unangetastet: die getippte Nummer
   * ist das, was der Beringer hat, und ein Knopf, der sie wortlos wegnimmt,
   * wäre schlimmer als keiner.
   */
  onFreieNummerUebernehmen(): void {
    const size = this.entryForm.get('ring_size')?.value as RingSize | null;
    if (!size) {
      this.keineFreieNummer.set(true);
      return;
    }
    this.dataAccess.getNextRingNumber(size, this.currentProject()?.id).subscribe({
      next: ({ next_number }) => {
        if (!next_number) {
          this.keineFreieNummer.set(true);
          return;
        }
        this.uebernehmen('ring_number', next_number);
      },
      // Ein Fehler über dem Fehler ist das schlechteste erreichbare Ergebnis
      // (ADR 0038): das Banner bleibt, wie es ist, und sagt nur, dass es keine
      // Nummer anzubieten hat.
      error: () => this.keineFreieNummer.set(true),
    });
  }

  /**
   * Was eine Abhilfe tut, und mehr tut sie nicht: einen Wert ins Formular
   * schreiben und ihn als ungespeichert kennzeichnen.
   *
   * `markAsDirty` ist hier die halbe Miete — ein programmatisch gesetzter Wert
   * ist für Angular nicht „berührt", und ohne diese Zeile wüsste weder der
   * `unsavedChangesGuard` (#407) noch Zurücksetzen (#24), dass hier etwas
   * steht, das noch niemand verantwortet hat.
   */
  private uebernehmen(name: string, wert: unknown): void {
    const control = this.entryForm.get(name);
    if (!control) {
      return;
    }
    control.setValue(wert);
    control.markAsDirty();
  }

  /**
   * Die Feldmarkierung: der Serversatz wird als Fehler auf genau dem
   * zurückgewiesenen Control gesetzt und macht es rot. Eine Zurückweisung ohne
   * einzelnes Feld (Erstfang gegen die falsche Zentrale, eine
   * Rechteverweigerung) markiert nichts — sie rendert nur das Banner.
   *
   * **Gelöscht wird sie, sobald genau dieses Feld bearbeitet wird**, und das
   * ganz von selbst: eine Wertänderung lässt Angular die Fehler des Controls aus
   * seinen Validatoren neu rechnen, und der von Hand gesetzte ist damit weg.
   * Ein *anderes* Feld zu bearbeiten rührt dieses Control nicht an — genau die
   * Trennung, die #443 verlangt.
   */
  private markRejectedField(failure: AppFailure): void {
    if (!failure.field) {
      return;
    }
    const name = CONTROL_FOR_SERVER_FIELD[failure.field] ?? failure.field;
    const control = this.entryForm.get(name);
    if (!control) {
      return;
    }
    // Nur markieren, was auch zu sehen ist. Ein Control ohne `mat-error` (eine
    // Checkbox, ein Fangmarker) oder ein abgeschaltetes (ein vom Projekt
    // ausgeblendetes Optionales Feld, die Zentrale am Erstfang) würde sonst
    // stumm rot — rot ohne Satz. Dann steht der Satz im Banner allein, was er
    // ohnehin immer tut.
    if (!SERVER_REJECTION_FIELD_SET.has(name) || control.disabled) {
      return;
    }
    control.setErrors({...(control.errors ?? {}), [SERVER_REJECTED]: failure.text});
    // Ohne „berührt" zeigt das mat-form-field den Fehler nicht an.
    control.markAsTouched();
  }

  /**
   * #443: alle Feldmarkierungen zurücknehmen — genau so, wie eine Bearbeitung
   * des Feldes es täte. `updateValueAndValidity` rechnet die Fehler des Controls
   * aus seinen **Validatoren** neu; der von Hand gesetzte Serversatz ist damit
   * weg, echte Eingabefehler bleiben stehen. `emitEvent: false`, damit keine der
   * Autocomplete-Pipelines auf einer unveränderten Eingabe neu sucht.
   */
  private clearServerRejections(): void {
    for (const control of Object.values(this.entryForm.controls)) {
      if (control.errors?.[SERVER_REJECTED] === undefined) {
        continue;
      }
      control.updateValueAndValidity({emitEvent: false});
    }
  }

  /**
   * #443: Ist Speichern gerade unmöglich?
   *
   * Eine Feldmarkierung macht das Control ungültig — sie ist ja rot. Sie darf
   * aber **niemals den Knopf sperren**: der einzige Ausweg der Klasse
   * *Korrigieren* ist „Bitte korrigieren und erneut speichern", und ADR 0037
   * baut darauf, dass eine Abhilfe das Formular füllt und das Mitglied dann
   * Speichern drückt. Ein gesperrter Knopf unter einem Banner, das zum Speichern
   * auffordert, wäre „ein Knopf, der wortlos nichts tut" (#427).
   *
   * Deshalb zählt hier nur, was **die Eingabe selbst** ungültig macht. Ein
   * abgeschaltetes Control trägt keine Fehler (Angular leert sie beim
   * Abschalten) und fällt damit hier heraus — dieselbe Rechnung wie
   * `entryForm.invalid`, bloß ohne den Serversatz.
   */
  protected saveBlocked(): boolean {
    return this.loading() || this.invalidBeyondServerRejection();
  }

  private invalidBeyondServerRejection(): boolean {
    if (this.entryForm.valid) {
      return false;
    }
    if (this.entryForm.errors) {
      return true;
    }
    return Object.values(this.entryForm.controls).some((control) =>
      Object.keys(control.errors ?? {}).some((key) => key !== SERVER_REJECTED),
    );
  }

  /** Der Serversatz an einem Feld, für dessen `mat-error` — sonst `null`. */
  serverRejection(controlName: string): string | null {
    const message = this.entryForm.get(controlName)?.errors?.[SERVER_REJECTED];
    return typeof message === 'string' ? message : null;
  }

  private getInitialDateTime(): string {
    const now = this.currentDate();
    now.setMinutes(0, 0, 0);
    return this.datePipe.transform(now, 'yyyy-MM-ddTHH:mm')!;
  }

  // #340: a single wall-clock seam so the auto-advancing Uhrzeit is deterministic
  // under test — every "now" the suggestion reads flows through here.
  protected currentDate(): Date {
    return new Date();
  }

  // #340: the "HH" hour component of a "yyyy-MM-ddTHH:mm" local datetime string,
  // or null when it can't be read. Compares wall-clock hour-of-day, so crossing
  // any hour boundary (incl. 23→00) counts as a change.
  private hourOf(dateTime: string | null | undefined): string | null {
    if (!dateTime || dateTime.length < 13) {
      return null;
    }
    return dateTime.slice(11, 13);
  }

  // #340: the top-of-hour label "HH:00" for a "yyyy-MM-ddTHH:mm" datetime string.
  private hourLabel(dateTime: string): string {
    const hour = this.hourOf(dateTime);
    return hour ? `${hour}:00` : '';
  }

  // #340: raise the non-blocking hour-change hint iff the freshly-suggested hour
  // differs from the hour of the entry just saved — never within the same hour.
  // The previous hour is stored snapped to its top-of-hour, which is exactly what
  // the revert writes back.
  private maybeSignalHourChange(savedDateTime: string | null, suggestedDateTime: string): void {
    const savedHour = this.hourOf(savedDateTime);
    const suggestedHour = this.hourOf(suggestedDateTime);
    if (savedHour !== null && suggestedHour !== null && savedHour !== suggestedHour) {
      this.hourChangeHint.set({
        previousDateTime: `${savedDateTime!.slice(0, 11)}${savedHour}:00`,
        suggestedDateTime,
      });
    } else {
      this.hourChangeHint.set(null);
    }
  }

  // #340: the one-click „auf HH:00 zurück" — write the previous hour back into the
  // time field and dismiss the hint. Non-sticky: the next save re-reads the clock
  // and decides afresh whether to warn again.
  revertToPreviousHour(): void {
    const hint = this.hourChangeHint();
    if (!hint) {
      return;
    }
    this.entryForm.get('date_time')?.setValue(hint.previousDateTime);
    this.hourChangeHint.set(null);
  }

  // #357: the ✕ dismiss on the top banner — accept the new hour. Unlike the revert,
  // it only clears the hint and leaves the clock-driven time untouched. Non-sticky:
  // the next save re-reads the clock and decides afresh whether to warn again.
  dismissHourChangeHint(): void {
    this.hourChangeHint.set(null);
  }

  private transformToForm(entry: DataEntry): any {
    const formValue = {...entry} as any;
    if (entry.ring) {
      formValue.ring_size = entry.ring.size;
      formValue.ring_number = entry.ring.number;
    }
    // #232: edit mode keys off the ring's STORED Zentrale, not UI history — an
    // entry with a foreign ring reopens in free-text mode. A pre-field entry with
    // no stored Zentrale falls back to the Projekt-Zentrale (the effective value
    // the backfill gives it server-side).
    formValue.central = entry.ring?.central ?? PROJEKT_ZENTRALE;
    formValue.date_time = this.datePipe.transform(entry.date_time, 'yyyy-MM-ddTHH:mm');
    return formValue;
  }

  // #341: an appNumberMask control holds a raw string. Coerce the two states the
  // mask can leave behind that the backend rejects: the empty string (a cleared
  // field → null, so IntegerField/DecimalField accept it) and a dangling decimal
  // point ("5." → "5", "." → null). A real number (edit mode preloads them) or an
  // already-null value passes through untouched.
  private static normalizeMaskedNumeric(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const trimmed = value.endsWith('.') ? value.slice(0, -1) : value;
    return trimmed === '' ? null : trimmed;
  }

  private transformFromForm(formValue: any): Partial<DataEntry> {
    const payload: any = {...formValue};
    for (const field of DataEntryFormComponent.MASKED_NUMERIC_CONTROLS) {
      payload[field] = DataEntryFormComponent.normalizeMaskedNumeric(payload[field]);
    }
    // #404: store the ring under the same value the lookup searches for. DRF
    // already trims a CharField on write, so an online POST lands trimmed either
    // way — but a capture queued OFFLINE is matched by assembleLocalRingHistory
    // with a strict ===, and a raw " AB1234 " there is invisible to the next
    // Wiederfang on the very device that recorded it. Trimming here makes the
    // outbox agree with the server. Only the ends: an inner space belongs to a
    // foreign Zentrale's number ("AB 1234"). A domestic ring never reaches this
    // holding whitespace — the `^[0-9]*$` pattern refuses it at the field (#232) —
    // but a foreign ring drops that pattern, which is exactly where a pasted
    // number arrives padded.
    if (typeof payload.ring_number === 'string') {
      payload.ring_number = payload.ring_number.trim();
    }
    payload.species_id = formValue.species?.id;
    payload.ringing_station_id = formValue.ringing_station?.handle;
    payload.staff_id = formValue.staff?.id;

    // #232: the Zentrale rides the write payload FLAT as the scheme code (like
    // ring_size), and only when it differs from the Projekt-Zentrale. A domestic
    // capture omits it entirely, so it submits exactly the same effective payload
    // as before this feature — the backend defaults an absent central to the
    // Projekt-Zentrale.
    const central = formValue.central as Central | string | null | undefined;
    delete payload.central;
    if (
      central &&
      typeof central === 'object' &&
      central.scheme_code &&
      central.scheme_code !== AUW_SCHEME_CODE
    ) {
      payload.central = central.scheme_code;
    }

    // #163: a queued edit must never re-derive project_id from the
    // *currently active* Projekt — the Mitglied may have switched Projekt
    // (via the ordinary picker) at any point between queueing and re-saving
    // the correction, and the active Projekt is not part of the capture's
    // own identity. Keep the id the entry was originally queued under
    // instead (undefined stays undefined, matching a create queued while no
    // Projekt was active), so re-saving a typo fix can never silently
    // reattribute the capture to a different Projekt. Only a genuine create
    // or an edit of an already-synced record derives project_id from the
    // active Projekt.
    if (this.isQueuedEditMode()) {
      payload.project_id = this.loadedQueuedEntry()!.payload['project_id'];
    } else {
      const project = this.currentProject();
      if (project) {
        payload.project_id = project.id;
      }
    }

    // #155/#163: a create carries a fresh idempotency key; re-saving a
    // queued entry carries the *same* key it already had (its own outbox
    // id) — it is still the same not-yet-synced capture, just corrected.
    // Editing an already-*synced* record must never send one at all (the
    // backend also enforces this).
    if (this.isQueuedEditMode()) {
      payload.idempotency_key = this.entryId()!;
    } else if (!this.isEditMode()) {
      payload.idempotency_key = this.idempotencyKey;
    }

    delete payload.species;
    delete payload.ringing_station;
    delete payload.staff;
    return payload;
  }

  // #23: a single form-level keyboard dispatch. Every keydown refreshes the
  // CapsLock indicator and routes save / Enter handling.
  onKeydown(event: KeyboardEvent): void {
    this.syncCapsLockState(event);

    // Strg+S / Cmd+S saves and suppresses the browser "save page" dialog. Works
    // in both create and edit mode; onSubmit() shows errors on an invalid form.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.onSubmit();
      return;
    }

    if (event.key === 'Enter') {
      this.onEnter(event);
      return;
    }

    // #338: left/right arrow field-jump is handled in the capture phase (wired in
    // the constructor), not here — it must run before Material's own element-level
    // keydown so a closed <mat-select> is not mutated by the navigation gesture.
  }

  // #338: left/right arrow field navigation. Right advances to the next field,
  // left to the previous one — the same forward/backward traversal Tab/Enter use,
  // skipping hidden and disabled controls. In a text input the jump fires only
  // when the caret already sits at the edge the arrow points at; otherwise the
  // arrow moves the caret natively within the value. Selects, checkboxes and
  // empty inputs carry no caret to preserve, so they jump immediately. Native
  // behaviour is left intact for datetime-local inputs (arrows step between
  // date/time segments) and while an autocomplete or select panel is open (arrows
  // navigate its options).
  //
  // Number fields (the measurement inputs) are the documented exception: browsers
  // do not expose the selection API on `type=number` (selectionStart is null and
  // cannot be set), so a *partly-filled* number input cannot be edge-detected — it
  // keeps native in-field caret movement and advances via Tab/Enter instead. See
  // the amended AC on #338. An *empty* number input still jumps, since there is no
  // caret position to protect.
  //
  // Runs in the CAPTURE phase (see the constructor wiring): when the gesture *is*
  // a jump it calls stopImmediatePropagation so Material's own element-level
  // keydown never runs — otherwise a closed <mat-select> would advance its
  // selected value before this handler could move focus away.
  private onArrowNav(event: KeyboardEvent): void {
    // Modified arrows (Shift-select, Ctrl/Alt word-jump, Cmd) stay native.
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const field = target.closest('[formControlName]') as HTMLElement | null;
    if (!field) {
      return;
    }
    const controlName = field.getAttribute('formControlName');
    if (!controlName) {
      return;
    }
    // An open autocomplete/select panel owns the arrows for option navigation.
    if (field.getAttribute('aria-expanded') === 'true') {
      return;
    }

    const goLeft = event.key === 'ArrowLeft';
    if (target instanceof HTMLInputElement) {
      // datetime-local: the arrows step between the date/time segments natively.
      if (target.type === 'datetime-local') {
        return;
      }
      // A filled text-bearing input jumps only at the caret edge; otherwise the
      // arrow moves the caret within the value. An empty input (value === '') has
      // no caret to preserve, so it jumps immediately like a select. A filled
      // number input hides its caret (caretAtEdge is always false) and so keeps
      // native movement — the accepted browser limitation.
      if (this.hasTextCaret(target) && target.value !== '' && !this.caretAtEdge(target, goLeft)) {
        return;
      }
    } else if (target instanceof HTMLTextAreaElement) {
      if (target.value !== '' && !this.caretAtEdge(target, goLeft)) {
        return;
      }
    }

    // This IS a field-jump gesture. Suppress the event entirely so no
    // element-level handler (notably a closed <mat-select>'s key manager) mutates
    // the field we are leaving; capture-phase stopImmediatePropagation stops it
    // before Material's own keydown runs.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (goLeft) {
      this.focusPrevious(controlName);
    } else {
      this.focusNext(controlName);
    }
  }

  // #338: input types that carry a text caret we must not hijack mid-value. A
  // type=number reports a null caret in Chrome/Safari — caretAtEdge treats that
  // as "not at an edge", so a *filled* number input keeps native in-field caret
  // movement rather than jumping unexpectedly (an empty one has no caret to
  // protect and jumps; see onArrowNav).
  private hasTextCaret(input: HTMLInputElement): boolean {
    return ['text', 'search', 'tel', 'url', 'password', 'email', 'number'].includes(input.type);
  }

  // #338: whether the caret sits at the field edge the arrow points at — the start
  // for left, the end for right — with no text selected. Inputs that hide their
  // caret position (type=number in Chrome) report null and are treated as "not at
  // an edge" so native movement is preserved.
  private caretAtEdge(el: HTMLInputElement | HTMLTextAreaElement, goLeft: boolean): boolean {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === null || end === null) {
      return false;
    }
    if (goLeft) {
      return start === 0 && end === 0;
    }
    const length = el.value.length;
    return start === length && end === length;
  }

  // #23/#59: a single context-dependent Enter dispatch. Enter never fires the
  // implicit form submit from a field; it advances the field workflow instead.
  // The only exceptions are focused controls that own Enter natively.
  private onEnter(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;

    // #59: any focused action button — let Enter activate it natively. The save
    // button (type="submit") submits; every other action button is type="button",
    // so native activation runs its click handler without an implicit submit.
    if (target instanceof HTMLButtonElement) {
      return;
    }
    // A textarea (Bemerkungen): Enter inserts a newline.
    if (target instanceof HTMLTextAreaElement) {
      return;
    }

    // Otherwise Enter must never submit the form.
    event.preventDefault();

    const controlName = target.getAttribute('formControlName');

    // In a Wiederfang, Enter in the Ringnummer field runs the ring-history
    // lookup (and prefill) instead of advancing — the Beringer's first move.
    if (controlName === 'ring_number' && this.isRecatch()) {
      this.fetchRingHistory();
      return;
    }

    if (controlName) {
      this.focusNext(controlName);
    }
  }

  onKeyup(event: KeyboardEvent): void {
    this.syncCapsLockState(event);
  }

  // #43: catch an already-active CapsLock on the first pointer/focus interaction,
  // before any keystroke. A MouseEvent carries getModifierState; a FocusEvent does
  // not, so the shared sync simply no-ops on events without it.
  onPointerOrFocus(event: Event): void {
    this.syncCapsLockState(event);
  }

  // #43: the single source of truth for the CapsLock indicator. The CapsLock key's
  // OWN keydown/keyup report an unreliable getModifierState mid-toggle across
  // browsers (the "activates regardless of state" / "never clears" bug), so its
  // state is tracked by toggling on keydown and ignoring its keyup. Every other
  // event — ordinary keystrokes, pointer, focus — reports a reliable reading and
  // is trusted directly, which both sets and clears the warning correctly.
  private syncCapsLockState(event: Event): void {
    if (event instanceof KeyboardEvent && event.key === 'CapsLock') {
      if (event.type === 'keydown') {
        this.capsLockOn.update(on => !on);
      }
      return;
    }
    const probe = event as Partial<KeyboardEvent & MouseEvent>;
    if (typeof probe.getModifierState === 'function') {
      this.capsLockOn.set(probe.getModifierState('CapsLock'));
    }
  }

  onSelectKeydown(event: KeyboardEvent, controlName: string, options: SelectOption<any>[], selectComponent: MatSelect): void {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const key = event.key.toLowerCase();
    const matchingOption = options.find(opt => opt.key === key);
    if (matchingOption) {
      event.preventDefault();
      this.setByUser(controlName, matchingOption.value);
      selectComponent.close();
      this.focusNext(controlName);
      // #362: setValue() does NOT emit MatSelect.selectionChange, so the central
      // Plausibilitätskontrolle the mouse-selection path runs (onCategoricalChange)
      // would be skipped — a keyboard-picked implausible value would only surface
      // on a later numeric-field blur. Re-run the same recompute here for EVERY
      // categorical select, so future categorical fields inherit correct timing.
      // focusNext already advanced focus, so pass controlName: a newly-appeared
      // warning modal then restores focus to the picked field on dismissal,
      // keeping keyboard entry flowing.
      this.evaluatePlausibility(controlName);
    }
  }

  // #23: on a rejected save, jump to the first invalid field in focus order so
  // the Beringer can fix it without hunting for the offending field.
  private focusFirstInvalid(): void {
    const firstInvalid = this.focusOrder.find(name => this.entryForm.get(name)?.invalid);
    if (!firstInvalid) {
      return;
    }
    const el = document.querySelector(`[formControlName="${firstInvalid}"]`) as HTMLElement | null;
    el?.focus();
  }

  private focusNext(currentControlName: string): void {
    const currentIndex = this.focusOrder.indexOf(currentControlName);
    if (currentIndex < 0) {
      return;
    }
    // #26/#338: skip disabled AND hidden fields (e.g. the greyed-out Kleingefieder
    // fields for a non-diesjährigen Vogel, or the net block hidden by the Projekt
    // switch) so the keyboard run never lands on a dead or absent field.
    const nextControlName = this.focusOrder
      .slice(currentIndex + 1)
      .find((name) => this.isNavigable(name));
    if (!nextControlName) {
      return;
    }
    setTimeout(() => this.focusField(nextControlName), 50);
  }

  // #338: the backward counterpart of focusNext — walks focusOrder toward the
  // start, skipping the same hidden/disabled fields, so left-arrow lands on the
  // previous live control.
  private focusPrevious(currentControlName: string): void {
    const currentIndex = this.focusOrder.indexOf(currentControlName);
    if (currentIndex < 0) {
      return;
    }
    const previousControlName = this.focusOrder
      .slice(0, currentIndex)
      .reverse()
      .find((name) => this.isNavigable(name));
    if (!previousControlName) {
      return;
    }
    setTimeout(() => this.focusField(previousControlName), 50);
  }

  // #338: a field is a keyboard-nav target only when it is both enabled and
  // actually rendered. Disabled controls (e.g. the greyed-out Kleingefieder
  // Fortschritt) and controls removed from the DOM by an @if (the net block
  // dropped by the Projekt switch, or the collapsed Ring-vernichtet fields) are
  // skipped so focus never dead-ends where the ringer cannot type.
  private isNavigable(name: string): boolean {
    if (this.entryForm.get(name)?.disabled) {
      return false;
    }
    return !!document.querySelector(`[formControlName="${name}"]`);
  }

  // #24: the single shared clean-reset routine. It clears the bird-specific
  // fields, keeps Station, Beringer and Projekt (Projekt lives on the project
  // signal, so it survives automatically), sets the date back to now, returns the
  // form to a pristine/untouched and non-submitted state — so no required-field
  // errors linger — and focuses the Art field so the next entry begins at once.
  private cleanReset(): void {
    const preserved = {
      ringing_station: this.entryForm.get('ringing_station')?.value,
      staff: this.entryForm.get('staff')?.value,
    };

    // #340: capture the Uhrzeit of the entry just saved *before* the reset
    // overwrites it, so we can compare it against the freshly-suggested hour below.
    const savedDateTime = this.entryForm.get('date_time')?.value as string | null;
    const suggestedDateTime = this.getInitialDateTime();

    // #273: the focus shift below blurs the Ringnummer while it still holds the
    // just-saved ring. Seed the "last searched ring" key with it first so that
    // incidental blur is recognised as already-handled and the auto-search
    // stands down — otherwise it would re-fetch the ring (now including the
    // freshly-queued capture) and re-prefill Art over the reset.
    this.lastSearchedRingKey = this.ringLookupKey();

    // Move focus to Art *before* resetting. Focusing synchronously blurs whatever
    // field was active (e.g. Ringnummer after a Strg+S save), and that blur marks
    // it touched — which would otherwise re-trigger its required-field error after
    // the reset. Doing it first lets the following resetForm() clear that touched
    // state, leaving a genuinely pristine, error-free form.
    this.focusField('species');

    this.resetFormTo({
      ...preserved,
      // #232: the Zentrale is NOT sticky across saves (unlike Station/Beringer) —
      // a foreign recapture is an exception, not session state — so each save
      // resets it to the Projekt default.
      central: PROJEKT_ZENTRALE,
      date_time: suggestedDateTime,
      age_class: AgeClass.Unknown,
      sex: Sex.Unknown,
      has_hunger_stripes: false,
      has_brood_patch: false,
      has_cpl_plus: false,
      parasites: [],
      // #371: the Fangmarker never carry over to the next capture.
      is_dead_recovery: false,
      is_non_standard: false,
    });

    this.selectedSpecies.set(null);
    this.recaptureHistory.set([]);
    this.historyPossiblyIncomplete.set(false);
    // PRD #245/#261: the acknowledgment is transient — clear the active warnings
    // (so the pristine form for the next capture shows no stale suffix icon) and
    // wipe the „fire once, never nag" signatures so the next capture starts fresh.
    this.plausibilityWarnings.set([]);
    this.acknowledgedSignatures.set(resetAcknowledgedSignatures());
    // #155: the just-saved capture "used up" this key — the next capture
    // (this same form instance, no navigation) must mint its own.
    this.idempotencyKey = crypto.randomUUID();
    this.lastFailedSubmission = null;

    // #340: last — raise (or clear) the non-blocking Stundenwechsel-Hinweis based
    // on whether the clock rolled to a new hour while the previous bird was saved.
    this.maybeSignalHourChange(savedDateTime, suggestedDateTime);
  }

  // #24: restore the loaded record's saved values, dropping the user's edits and
  // returning the form to a pristine, error-free state. Issue #163: a queued
  // entry restores from its already-resolved form value instead of
  // `transformToForm()`, which expects a server-shaped `DataEntry`.
  private resetToSaved(): void {
    if (this.isQueuedEditMode()) {
      const formValue = this.loadedQueuedFormValue();
      if (!formValue) {
        return;
      }
      this.resetFormTo(formValue);
      this.selectedSpecies.set((formValue['species'] as Species | null) ?? null);
      this.recaptureHistory.set([]);
      this.historyPossiblyIncomplete.set(false);
      return;
    }
    const entry = this.loadedEntry();
    if (!entry) {
      return;
    }
    this.resetFormTo(this.transformToForm(entry));
    this.selectedSpecies.set(entry.species ?? null);
    this.recaptureHistory.set([]);
    this.historyPossiblyIncomplete.set(false);
  }

  // #24: reset through the FormGroupDirective when it is available so the
  // "submitted" flag is cleared along with the values; entryForm.reset() alone
  // leaves it set, which is the post-save required-field-error bug.
  private resetFormTo(values: Record<string, unknown>): void {
    const directive = this.formDirective();
    if (directive) {
      directive.resetForm(values);
    } else {
      this.entryForm.reset(values);
    }
  }

  // Focus a field synchronously. Synchronous (unlike focusNext) so the resulting
  // blur of the previously active field is settled before a following form reset.
  private focusField(controlName: string): void {
    const el = document.querySelector(`[formControlName="${controlName}"]`) as HTMLElement | null;
    el?.focus();
  }
}

import {
  ChangeDetectionStrategy,
  Component,
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

import {debounceTime, distinctUntilChanged, switchMap, startWith, map, tap} from 'rxjs/operators';
import {Observable} from 'rxjs';

import {
  AgeClass,
  BirdStatus,
  DataEntry,
  Direction,
  HandWingMoult,
  MuscleClass,
  Sex,
  SmallFeatherAppMoult,
  SmallFeatherIntMoult,
  SelectOption, FatClass
} from '../models/data-entry.model';
import {ApiService} from '../service/api.service';
import {DataAccessFacadeService} from '../service/data-access-facade.service';
import {OutboxService} from '../service/outbox.service';
import {ProjectService} from '../service/project.service';
import {WorkbenchStorageService} from '../service/workbench-storage.service';
import {ReferenceBundleCacheService} from '../core/offline/reference-bundle-cache';
import {resolveQueuedEntryDisplay} from '../core/offline/queued-entry-display';
import {OutboxEntry} from '../models/outbox-entry.model';
import {Species} from '../models/species.model';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {RingingStation} from '../models/ringing-station.model';
import {Scientist} from '../models/scientist.model';
import {RingSize} from '../models/ring.model';
import {AUW_SCHEME_CODE, Central, PROJEKT_ZENTRALE} from '../models/central.model';
import {SelectOnTabDirective} from '../core/directives/select-on-tab';
import {MatTableModule} from '@angular/material/table';
import {DataEntryDetailDialogComponent} from './data-entry-detail-dialog/data-entry-detail-dialog';
import {
  BeringerCreateDialogComponent,
  BeringerCreateDialogResult,
} from './beringer-create-dialog/beringer-create-dialog';
import {ConfirmDialogComponent, ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';
import {selectedOptionValidator} from '../shared/validators/selected-option.validator';
import {getAgeClassLabel, getSexLabel} from './data-entry-labels';
import {
  computePlausibilityWarnings,
  PlausibilityMeasurements,
  PlausibilityWarning,
  SpeciesNorm,
} from '../core/plausibility/plausibility';

// #232: the strict Austrian (AUW) ring-size codes. When the Zentrale switches
// back from a foreign scheme to the Projekt-Zentrale, a free-text Größe that is
// not one of these is cleared so the restored dropdown never carries an unlisted
// value.
const AUSTRIAN_RING_SIZES = new Set<string>(Object.values(RingSize));

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
    MatCheckboxModule,
    MatSnackBarModule,
    MatTableModule,
    MatDialogModule,
    MatIconModule,
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
export class DataEntryFormComponent implements OnInit {
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
  private readonly datePipe = inject(DatePipe);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly currentProject = this.projectService.currentProject;
  readonly showOptionalFields = computed(() => this.currentProject()?.show_optional_fields ?? true);

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
  // Issue #164: the server's rejection message when this queued entry was
  // skipped-and-flagged during sync — shown as a banner so the Mitglied knows
  // exactly what to fix before re-saving (which re-queues it clean). `null`
  // for an ordinary, never-rejected queued entry.
  readonly syncError = computed(() => this.loadedQueuedEntry()?.syncError ?? null);
  // The queued entry's payload resolved to display-ready form values (issue
  // #163), kept alongside `loadedQueuedEntry` so Zurücksetzen can restore it
  // without re-reading the reference cache.
  private readonly loadedQueuedFormValue = signal<Record<string, unknown> | null>(null);
  readonly loading = signal<boolean>(false);
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
  readonly displayedHistoryColumns: string[] = [
    'date_time', 'species', 'bird_status', 'staff', 'tarsus', 'feather_span', 'wing_span', 'weight_gram',
    'age_class', 'sex', 'actions'
  ];
  readonly BirdStatus = BirdStatus;

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
    has_mites: [false, Validators.required],
    has_hunger_stripes: [false, Validators.required],
    has_brood_patch: [false, Validators.required],
    has_cpl_plus: [false, Validators.required],
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

  private readonly focusOrder: string[] = [
    'ringing_station', 'staff', 'date_time', 'species', 'bird_status', 'central', 'ring_size', 'ring_number',
    'net_location', 'net_height', 'net_direction', 'age_class', 'sex', 'fat_deposit', 'muscle_class',
    'small_feather_int', 'small_feather_app', 'hand_wing',
    'tarsus', 'feather_span', 'wing_span', 'weight_gram', 'comment',
    'has_mites', 'has_hunger_stripes', 'has_brood_patch', 'has_cpl_plus',
    'notch_f2', 'inner_foot'
  ];


  birdStatusOptions: SelectOption<BirdStatus | null>[] = [
    {value: null, viewValue: '---'},
    {value: BirdStatus.FirstCatch, viewValue: 'Erstfang (e)', key: 'e'},
    {value: BirdStatus.ReCatch, viewValue: 'Wiederfang (w)', key: 'w'}
  ];

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

    // Issue #57: an 'unknown_species' capture ("Aves ignota") is a real bird
    // whose unusual catch must always be described, so the Bemerkung becomes
    // mandatory while it is selected. Mirrors the sentinel validator-toggling
    // above; the serializer enforces the same rule server-side.
    effect(() => {
      const unknown = this.isUnknownSpecies();
      const control = this.entryForm.get('comment')!;
      control.setValidators(unknown ? [Validators.required] : []);
      control.updateValueAndValidity({ emitEvent: false });
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

      this.loading.set(true);
      this.apiService.getDataEntry(id).subscribe(entry => {
        this.loadedEntry.set(entry);
        this.entryForm.patchValue(this.transformToForm(entry));
        // Issue #19/#57: a loaded Sonderart entry must apply the same
        // collapse / mandatory-comment behaviour as a freshly selected one.
        this.selectedSpecies.set(entry.species ?? null);
        this.loading.set(false);
      });
    });
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
    // Issue #19/#57: a loaded Sonderart entry must apply the same collapse /
    // mandatory-comment behaviour as a freshly selected one.
    this.selectedSpecies.set(display.species);
    this.loading.set(false);
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

    // Issue #19/#57: load the "Ring Vernichtet" Art so the quick-button can
    // apply it in one click. It is identified by special_kind === 'ring_destroyed'.
    this.dataAccess.getSpecies('', this.currentProject()?.id).subscribe(response => {
      this.ringDestroyedSpecies.set(
        response.results.find(s => s.special_kind === 'ring_destroyed') ?? null,
      );
    });

    // PRD #245: load the per-org Artennormen from the offline reference bundle
    // so the plausibility lookup works the same online and offline.
    void this.loadNorms();
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
        error: () => {
          this.snackBar.open('Beringer konnte nicht angelegt werden.', 'Schließen', {duration: 3000});
        },
      });
    });
  }

  // Issue #19: the discreet quick-button near the Ringnummer field. It confirms
  // the rare destroyed-ring case before collapsing the form to the essentials.
  onDestroyedRing(): void {
    const ringDestroyed = this.ringDestroyedSpecies();
    if (!ringDestroyed) {
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
        this.entryForm.get('species')!.setValue(ringDestroyed);
        this.selectedSpecies.set(ringDestroyed);
      }
    });
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
    // PRD #245: the effective Artennorm changes with the Art, so re-evaluate any
    // active Plausibilitätswarnung against the newly selected species' norm.
    this.recomputePlausibility();
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

  fetchRingHistory(): void {
    const ringSize = this.entryForm.get('ring_size')?.value;
    const ringNumber = this.entryForm.get('ring_number')?.value;
    if (!ringSize || !ringNumber) {
      return;
    }
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
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Fehler beim Laden der Ringhistorie.', 'Schließen', {duration: 3000});
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

  // PRD #245: recompute the inline Plausibilitätswarnungen from the current form
  // values and the selected Art's effective norm. Bound to a measurement field's
  // blur, so the warning surfaces exactly when the value is finished — the same
  // non-modal role="alert" idiom the sex-contradiction hint rides. Also called
  // when the Art changes so a stale warning never lingers.
  onMeasurementBlur(): void {
    this.recomputePlausibility();
  }

  // Issue #249: the two categorical-flag rules read the Alter, Geschlecht and
  // Handschwingenmauser selects, which settle on selectionChange rather than an
  // input blur — recompute there so the flag Warnung surfaces the moment the
  // value is picked, mirroring the numeric on-blur behaviour. (Alter carries no
  // warning of its own but gates the dj-Großgefiedermauser rule.)
  onCategoricalChange(): void {
    this.recomputePlausibility();
  }

  private recomputePlausibility(): void {
    this.plausibilityWarnings.set(
      computePlausibilityWarnings(this.currentMeasurements(), this.activeNorm()),
    );
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
    if (this.entryForm.invalid) {
      Object.values(this.entryForm.controls).forEach(control => {
        if (control.invalid) {
          control.markAsTouched();
        }
      });
      this.focusFirstInvalid();
      return;
    }

    // PRD #245: gate the save on the Plausibilitätsprüfung. Compute the active
    // Warnungen from the single-source pure function; if any fire, ONE aggregated
    // Bestätigung (the shared confirm-dialog) lists the discrepancies —
    // confirming proceeds to write/queue, cancelling returns to the form. The
    // acknowledgment is transient and never persisted (identical in create and
    // edit mode).
    const warnings = computePlausibilityWarnings(this.currentMeasurements(), this.activeNorm());
    this.plausibilityWarnings.set(warnings);
    if (warnings.length > 0) {
      const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
        ConfirmDialogComponent,
        {
          data: {
            title: 'Plausibilität prüfen',
            message:
              'Folgende Messwerte liegen außerhalb des erwarteten Bereichs:\n\n' +
              warnings.map(w => w.message).join('\n') +
              '\n\nTrotzdem speichern?',
            confirmLabel: 'Trotzdem speichern',
            cancelLabel: 'Zurück',
          },
          width: '480px',
        },
      );
      ref.afterClosed().subscribe(confirmed => {
        if (confirmed) {
          this.performSave();
        }
        // Cancel: return to the form, nothing written or queued.
      });
      return;
    }

    this.performSave();
  }

  private performSave(): void {
    this.loading.set(true);
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
    // of an already-*synced* record always targets the server, so it stays on
    // `apiService` unchanged (offline edits of synced entries are out of
    // scope for PRD #152 — see its "Out of Scope" section).
    const saveOperation: Observable<unknown> = this.isQueuedEditMode()
      ? this.outbox.update(this.entryId()!, formValue as Record<string, unknown>)
      : this.isEditMode()
        ? this.apiService.updateDataEntry(this.entryId()!, formValue)
        : this.dataAccess.createDataEntry(formValue);

    saveOperation.subscribe({
      next: () => {
        this.rememberBeringer();
        this.lastFailedSubmission = null;
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
      error: (err) => {
        console.error('Error saving data entry', err);
        if (!this.isEditMode()) {
          this.lastFailedSubmission = JSON.stringify(rawValue);
        }
        this.snackBar.open(`Fehler beim Speichern: ${err.message}`, 'Schließen');
        this.loading.set(false);
      },
      complete: () => this.loading.set(false)
    });
  }

  private getInitialDateTime(): string {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return this.datePipe.transform(now, 'yyyy-MM-ddTHH:mm')!;
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

  private transformFromForm(formValue: any): Partial<DataEntry> {
    const payload: any = {...formValue};
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
    }
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
      this.entryForm.get(controlName)?.setValue(matchingOption.value);
      selectComponent.close();
      this.focusNext(controlName);
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
    // #26: skip disabled fields (e.g. the greyed-out Kleingefieder fields for a
    // non-diesjährigen Vogel) so the keyboard run never lands on a dead field.
    const nextControlName = this.focusOrder
      .slice(currentIndex + 1)
      .find((name) => !this.entryForm.get(name)?.disabled);
    if (!nextControlName) {
      return;
    }
    setTimeout(() => {
      const nextEl = document.querySelector(`[formControlName="${nextControlName}"]`) as HTMLElement;
      nextEl?.focus();
    }, 50);
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
      date_time: this.getInitialDateTime(),
      age_class: AgeClass.Unknown,
      sex: Sex.Unknown,
      has_mites: false,
      has_hunger_stripes: false,
      has_brood_patch: false,
      has_cpl_plus: false,
    });

    this.selectedSpecies.set(null);
    this.recaptureHistory.set([]);
    this.historyPossiblyIncomplete.set(false);
    // PRD #245: the acknowledgment is transient — clear the inline warning so the
    // pristine form for the next capture starts with no stale Plausibilitätshint.
    this.plausibilityWarnings.set([]);
    // #155: the just-saved capture "used up" this key — the next capture
    // (this same form instance, no navigation) must mint its own.
    this.idempotencyKey = crypto.randomUUID();
    this.lastFailedSubmission = null;
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

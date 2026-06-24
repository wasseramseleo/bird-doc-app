import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
// Import toSignal
import {toSignal} from '@angular/core/rxjs-interop';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import {ActivatedRoute, Router} from '@angular/router';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelect, MatSelectModule} from '@angular/material/select';
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
import {ProjectService} from '../service/project.service';
import {WorkbenchStorageService} from '../service/workbench-storage.service';
import {Species} from '../models/species.model';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {RingingStation} from '../models/ringing-station.model';
import {Scientist} from '../models/scientist.model';
import {RingSize} from '../models/ring.model';
import {SelectOnTabDirective} from '../core/directives/select-on-tab';
import {MatTableModule} from '@angular/material/table';
import {DataEntryDetailDialogComponent} from './data-entry-detail-dialog/data-entry-detail-dialog';
import {
  BeringerCreateDialogComponent,
  BeringerCreateDialogResult,
} from './beringer-create-dialog/beringer-create-dialog';
import {ConfirmDialogComponent, ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';

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
  },
})
export class DataEntryFormComponent implements OnInit {
  // Services and Router
  private readonly fb = inject(FormBuilder);
  private readonly apiService = inject(ApiService);
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
  readonly loading = signal<boolean>(false);
  // MO-3 submit feedback: drives the brief green "Gespeichert ✓" button state.
  readonly saved = signal<boolean>(false);
  // #23: a prominent CapsLock warning. Beringer type ring numbers and codes
  // blind; an unnoticed CapsLock would silently corrupt single-char shortcuts.
  readonly capsLockOn = signal<boolean>(false);

  // Recapture History State
  readonly recaptureHistory = signal<DataEntry[]>([]);
  readonly displayedHistoryColumns: string[] = [
    'date_time', 'species', 'bird_status', 'staff', 'tarsus', 'feather_span', 'wing_span', 'weight_gram', 'actions'
  ];
  readonly BirdStatus = BirdStatus;

  // Form Definition
  entryForm = this.fb.group({
    ringing_station: [null as RingingStation | null, Validators.required],
    staff: [null as Scientist | null, Validators.required],
    date_time: [this.getInitialDateTime(), Validators.required],
    species: [null as Species | null, Validators.required],
    bird_status: [null as BirdStatus | null, Validators.required],
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
  private readonly birdStatus = toSignal(this.entryForm.get('bird_status')!.valueChanges);
  readonly isRecatch = computed(() => this.birdStatus() === BirdStatus.ReCatch);

  // #26: the Kleingefieder (small-feather) moult fields are recorded only for
  // diesjährige birds (Alter = 3). Track the age class so the two fields can
  // react to changes; seed with the form's current value since valueChanges
  // does not emit until the first change.
  private readonly ageClass = toSignal(this.entryForm.get('age_class')!.valueChanges, {
    initialValue: this.entryForm.get('age_class')!.value,
  });
  readonly smallFeatherActive = computed(() => this.ageClass() === AgeClass.ThisYear);

  // Issue #19: the selected Art drives whether this is a "Ring Vernichtet"
  // sentinel record. A sentinel collapses the form to the essentials.
  readonly selectedSpecies = signal<Species | null>(null);
  readonly isSentinel = computed(() => !!this.selectedSpecies()?.is_sentinel);
  // The sentinel Art the quick-button applies, fetched once on init (the backend
  // always includes sentinels in the species list). Keyed off the is_sentinel
  // flag, not the German name.
  private readonly sentinelSpecies = signal<Species | null>(null);

  // Autocomplete Observables
  filteredSpecies!: Observable<Species[]>;
  filteredStations!: Observable<RingingStation[]>;
  filteredScientists!: Observable<Scientist[]>;

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
    'ringing_station', 'staff', 'date_time', 'species', 'bird_status', 'ring_size', 'ring_number',
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

  ringSizeOptions: SelectOption<RingSize>[] = [{
    value: RingSize.XSmall,
    viewValue: 'V ()',
    key: 'v'
  }, {value: RingSize.Small, viewValue: 'T ()', key: 't'}, {
    value: RingSize.Medium,
    viewValue: 'S (Medium)',
    key: 's'
  }, {value: RingSize.Large, viewValue: 'X ()', key: 'x'}, {
    value: RingSize.XLarge,
    viewValue: 'P ()',
    key: 'p'
  },];

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
        this.apiService.getNextRingNumber(size, projectId).subscribe(res => {
          this.entryForm.get('ring_number')?.setValue(res.next_number.toString());
        });
      }
    });

    // Issue #19: a sentinel "Ring Vernichtet" record carries no bird data, so
    // the bird-field validators must step aside or the collapsed form could
    // never be submitted. Ringnummer/Ringgröße stay required.
    effect(() => {
      const sentinel = this.isSentinel();
      for (const name of ['bird_status', 'age_class', 'sex']) {
        const control = this.entryForm.get(name)!;
        control.setValidators(sentinel ? [] : [Validators.required]);
        control.updateValueAndValidity({ emitEvent: false });
      }
    });

    // #26: keep the Kleingefieder fields in lockstep with the age class. Only a
    // diesjähriger Vogel (Alter = 3) moults its small feathers, so for every
    // other age class the two fields are cleared and disabled (greyed out but
    // still visible). Clearing matters: the export reads getRawValue(), which
    // includes disabled controls, so a stale value would otherwise leak through.
    effect(() => {
      const active = this.smallFeatherActive();
      for (const name of ['small_feather_int', 'small_feather_app']) {
        const control = this.entryForm.get(name)!;
        if (active) {
          control.enable({ emitEvent: false });
        } else {
          control.setValue(null, { emitEvent: false });
          control.disable({ emitEvent: false });
        }
      }
    });

    effect(() => {
      const id = this.entryId();
      if (id) {
        this.loading.set(true);
        this.apiService.getDataEntry(id).subscribe(entry => {
          this.entryForm.patchValue(this.transformToForm(entry));
          // Issue #19: a loaded sentinel entry must collapse the same way.
          this.selectedSpecies.set(entry.species ?? null);
          this.loading.set(false);
        });
      }
    });
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
      switchMap(name => this.apiService.getSpecies(name).pipe(map(response => response.results)))
    );

    this.filteredStations = this.entryForm.get('ringing_station')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      map(value => (typeof value === 'string' ? value : value?.name ?? '')),
      distinctUntilChanged(),
      switchMap(name => this.apiService.getRingingStations(name, this.currentProject()?.organization.handle).pipe(map(response => response.results)))
    );

    this.filteredScientists = this.entryForm.get('staff')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      map(value => (typeof value === 'string' ? value : value?.full_name ?? '')),
      distinctUntilChanged(),
      tap(term => this.staffSearchTerm.set(term)),
      switchMap(name => this.apiService.getScientists(name).pipe(map(response => response.results))),
      tap(results => this.staffResults.set(results)),
    );

    this.prefillRememberedBeringer();

    // Issue #19: load the "Ring Vernichtet" sentinel Art so the quick-button can
    // apply it in one click. It is identified by the is_sentinel flag.
    this.apiService.getSpecies('').subscribe(response => {
      this.sentinelSpecies.set(response.results.find(s => s.is_sentinel) ?? null);
    });
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
      this.apiService.createScientist(result).subscribe({
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
    const sentinel = this.sentinelSpecies();
    if (!sentinel) {
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
        this.entryForm.get('species')!.setValue(sentinel);
        this.selectedSpecies.set(sentinel);
      }
    });
  }

  onSpeciesSelected(event: MatAutocompleteSelectedEvent): void {
    const species: Species = event.option.value;
    this.selectedSpecies.set(species ?? null);
    if (species && species.ring_size) {
      this.entryForm.get('ring_size')?.setValue(species.ring_size);
    }
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

  fetchRingHistory(): void {
    const ringSize = this.entryForm.get('ring_size')?.value;
    const ringNumber = this.entryForm.get('ring_number')?.value;
    if (!ringSize || !ringNumber) {
      return;
    }
    this.loading.set(true);
    this.apiService.getDataEntriesByRing(ringSize, ringNumber).subscribe({
      next: (response) => {
        if (response.results.length > 0) {
          this.recaptureHistory.set(response.results);
          this.prefillFromPriorCatch(response.results);
          this.snackBar.open(`${response.results.length} frühere Einträge für diesen Ring gefunden.`, 'Schließen', {duration: 3000});
        } else {
          this.recaptureHistory.set([]);
          // Non-blocking: a bird ringed outside the app can still be recorded.
          this.snackBar.open('Keine früheren Einträge für diesen Ring gefunden.', 'Schließen', {duration: 3000});
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

  onCancel(): void {
    if (!this.isEditMode()) {
      this.router.navigateByUrl('/');
      return;
    }
    if (!this.entryForm.dirty) {
      this.router.navigateByUrl('/data-entries');
      return;
    }
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data: {
          title: 'Bearbeitung abbrechen?',
          message: 'Es gibt ungespeicherte Änderungen. Möchtest du die Bearbeitung wirklich abbrechen?',
          confirmLabel: 'Verwerfen',
          cancelLabel: 'Weiter bearbeiten',
        },
        width: '420px',
      },
    );
    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.router.navigateByUrl('/data-entries');
      }
    });
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

    this.loading.set(true);
    const formValue = this.transformFromForm(this.entryForm.getRawValue());

    const saveOperation = this.isEditMode()
      ? this.apiService.updateDataEntry(this.entryId()!, formValue)
      : this.apiService.createDataEntry(formValue);

    saveOperation.subscribe({
      next: () => {
        this.rememberBeringer();
        this.snackBar.open('Beringungseintrag gespeichert.', undefined, {
          duration: 2000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });
        if (this.isEditMode()) {
          // Edits return to the list hub; high-speed create flow stays put.
          this.router.navigateByUrl('/data-entries');
          return;
        }
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 900);
        this.clearForm();
      },
      error: (err) => {
        console.error('Error saving data entry', err);
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
    formValue.date_time = this.datePipe.transform(entry.date_time, 'yyyy-MM-ddTHH:mm');
    return formValue;
  }

  private transformFromForm(formValue: any): Partial<DataEntry> {
    const payload: any = {...formValue};
    payload.species_id = formValue.species?.id;
    payload.ringing_station_id = formValue.ringing_station?.handle;
    payload.staff_id = formValue.staff?.id;

    const project = this.currentProject();
    if (project) {
      payload.project_id = project.id;
    }

    delete payload.species;
    delete payload.ringing_station;
    delete payload.staff;
    return payload;
  }

  // #23: a single form-level keyboard dispatch. Every keydown refreshes the
  // CapsLock indicator and routes save / Enter handling.
  onKeydown(event: KeyboardEvent): void {
    this.capsLockOn.set(event.getModifierState('CapsLock'));

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

  // #23: a single context-dependent Enter dispatch. Enter never submits the
  // record except when the save button itself is focused; everywhere else it
  // advances the field workflow instead of firing the implicit form submit.
  private onEnter(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;

    // The save button: let Enter activate it (native button → submit).
    if (target instanceof HTMLButtonElement && target.type === 'submit') {
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
    this.capsLockOn.set(event.getModifierState('CapsLock'));
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

  private clearForm(): void {
    const preservedValues = {
      ringing_station: this.entryForm.get('ringing_station')?.value,
      staff: this.entryForm.get('staff')?.value,
    };

    this.entryForm.reset({
      ...preservedValues,
      date_time: this.getInitialDateTime(),
      age_class: AgeClass.Unknown,
      sex: Sex.Unknown,
      has_mites: false,
      has_hunger_stripes: false,
      has_brood_patch: false,
      has_cpl_plus: false,
    });

    this.recaptureHistory.set([]);

  }
}

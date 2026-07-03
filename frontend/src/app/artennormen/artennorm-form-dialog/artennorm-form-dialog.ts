import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormBuilder, ReactiveFormsModule, FormControl} from '@angular/forms';
import {MatAutocompleteModule, MatAutocompleteSelectedEvent} from '@angular/material/autocomplete';
import {MatButtonModule} from '@angular/material/button';
import {MatDialogModule, MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {debounceTime, distinctUntilChanged, map, of, switchMap} from 'rxjs';

import {ApiService} from '../../service/api.service';
import {Species} from '../../models/species.model';
import {
  EffectiveSpeciesNorm,
  SpeciesNormOverridePayload,
} from '../../models/species-norm.model';

export interface ArtennormFormDialogData {
  // Present when tuning a species already in force (edit): the species is fixed
  // and the form pre-fills from its effective norm. Absent in "add" mode, where
  // a species is chosen via the autocomplete and the form starts blank —
  // add-for-any-species, including a species with no global default (PRD #245).
  norm?: EffectiveSpeciesNorm;
}

// One Ø/SD measurement band, rendered as a pair of inputs. Clearing either input
// switches that band's Ausreißertest off for the Organisation (ADR 0021).
interface BandField {
  mean: string;
  sd: string;
  label: string;
  unit: string;
}

const BANDS: readonly BandField[] = [
  {mean: 'weight_mean', sd: 'weight_sd', label: 'Gewicht', unit: 'g'},
  {mean: 'feather_mean', sd: 'feather_sd', label: 'Federlänge', unit: 'mm'},
  {mean: 'wing_mean', sd: 'wing_sd', label: 'Flügellänge', unit: 'mm'},
  {mean: 'tarsus_mean', sd: 'tarsus_sd', label: 'Tarsus', unit: 'mm'},
  {mean: 'notch_f2_mean', sd: 'notch_f2_sd', label: 'Kerbe F2', unit: 'mm'},
  {mean: 'inner_foot_mean', sd: 'inner_foot_sd', label: 'Innenfuß', unit: 'mm'},
];

// Every tunable numeric column (the six bands + the Quotient + the SD-Faktor).
const NUMERIC_COLUMNS = [
  ...BANDS.flatMap((b) => [b.mean, b.sd]),
  'quotient_mean',
  'quotient_tolerance_pct',
  'sd_factor',
] as const;

// The two categorical tri-state flags (null = check off, otherwise Ja/Nein).
const FLAG_COLUMNS = [
  'geschlechtsbestimmung_moeglich',
  'dj_grossgefiedermauser_moeglich',
] as const;

@Component({
  selector: 'app-artennorm-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatAutocompleteModule,
  ],
  templateUrl: './artennorm-form-dialog.html',
  styleUrl: './artennorm-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArtennormFormDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly dialogRef =
    inject<MatDialogRef<ArtennormFormDialogComponent, SpeciesNormOverridePayload>>(MatDialogRef);
  readonly data = inject<ArtennormFormDialogData>(MAT_DIALOG_DATA);

  readonly isEdit = !!this.data.norm;
  readonly bands = BANDS;

  // Add mode only: the species search (autocomplete) and the chosen Art.
  readonly speciesSearch = new FormControl<string | Species>('', {nonNullable: true});
  readonly speciesOptions = signal<Species[]>([]);
  readonly selectedSpecies = signal<Species | null>(null);

  readonly form = this.fb.nonNullable.group({
    weight_mean: [''],
    weight_sd: [''],
    feather_mean: [''],
    feather_sd: [''],
    wing_mean: [''],
    wing_sd: [''],
    tarsus_mean: [''],
    tarsus_sd: [''],
    notch_f2_mean: [''],
    notch_f2_sd: [''],
    inner_foot_mean: [''],
    inner_foot_sd: [''],
    quotient_mean: [''],
    quotient_tolerance_pct: [''],
    sd_factor: [''],
    geschlechtsbestimmung_moeglich: [''],
    dj_grossgefiedermauser_moeglich: [''],
  });

  constructor() {
    if (this.data.norm) {
      this.prefill(this.data.norm);
    }

    // Add mode: debounced species search, mirroring the capture form's pickers.
    this.speciesSearch.valueChanges
      .pipe(
        debounceTime(300),
        map((value) => (typeof value === 'string' ? value : (value?.common_name_de ?? ''))),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length >= 2
            ? this.api.getSpecies(term).pipe(map((res) => res.results))
            : of([] as Species[]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => this.speciesOptions.set(results));
  }

  // Show the Art's common name in the autocomplete input.
  displaySpecies(species: Species | string | null): string {
    return typeof species === 'object' && species ? species.common_name_de : (species ?? '');
  }

  onSpeciesSelected(event: MatAutocompleteSelectedEvent): void {
    this.selectedSpecies.set(event.option.value as Species);
  }

  // In edit mode the species is fixed; in add mode it is the chosen Art. Submit
  // is blocked until one is chosen.
  private speciesId(): string | null {
    return this.data.norm?.species_id ?? this.selectedSpecies()?.id ?? null;
  }

  // The name to show in the dialog title (the fixed Art, or the chosen one).
  speciesLabel(): string {
    return this.data.norm?.species_name ?? this.selectedSpecies()?.common_name_de ?? '';
  }

  submit(): void {
    const species_id = this.speciesId();
    if (!species_id) {
      return;
    }
    this.dialogRef.close(this.buildPayload(species_id));
  }

  cancel(): void {
    this.dialogRef.close();
  }

  // A blank input clears that check (null); every other numeric column rides the
  // wire as the typed string. A flag's blank option is null (check off), else the
  // Ja/Nein boolean. The full row is always sent, so clearing one field disables
  // exactly that check (ADR 0021 whole-row).
  private buildPayload(species_id: string): SpeciesNormOverridePayload {
    const raw = this.form.getRawValue() as Record<string, string>;
    const payload: Record<string, unknown> = {species_id};
    for (const column of NUMERIC_COLUMNS) {
      payload[column] = raw[column] === '' ? null : raw[column];
    }
    for (const column of FLAG_COLUMNS) {
      payload[column] = raw[column] === '' ? null : raw[column] === 'true';
    }
    return payload as unknown as SpeciesNormOverridePayload;
  }

  private prefill(norm: EffectiveSpeciesNorm): void {
    const source = norm as unknown as Record<string, unknown>;
    const patch: Record<string, string> = {};
    for (const column of [...NUMERIC_COLUMNS, ...FLAG_COLUMNS]) {
      const value = source[column];
      patch[column] = value === null || value === undefined ? '' : String(value);
    }
    this.form.patchValue(patch);
  }
}

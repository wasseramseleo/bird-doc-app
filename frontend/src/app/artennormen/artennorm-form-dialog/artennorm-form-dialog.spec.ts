import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatDialogRef, MAT_DIALOG_DATA} from '@angular/material/dialog';

import {
  ArtennormDialogResult,
  ArtennormFormDialogComponent,
  ArtennormFormDialogData,
} from './artennorm-form-dialog';
import {EffectiveSpeciesNorm} from '../../models/species-norm.model';
import {RingSize} from '../../models/ring.model';
import {Species} from '../../models/species.model';

function makeNorm(overrides: Partial<EffectiveSpeciesNorm> = {}): EffectiveSpeciesNorm {
  return {
    species_id: 'sp-1',
    species_name: 'Zaunkönig',
    weight_mean: '9.100',
    weight_sd: '0.820',
    feather_mean: null,
    feather_sd: null,
    wing_mean: null,
    wing_sd: null,
    tarsus_mean: null,
    tarsus_sd: null,
    notch_f2_mean: null,
    notch_f2_sd: null,
    inner_foot_mean: null,
    inner_foot_sd: null,
    quotient_mean: null,
    quotient_tolerance_pct: null,
    sd_factor: '1.960',
    geschlechtsbestimmung_moeglich: null,
    dj_grossgefiedermauser_moeglich: null,
    ...overrides,
  };
}

function makeSpecies(overrides: Partial<Species> = {}): Species {
  return {
    id: 'new-sp',
    common_name_de: 'Kohlmeise',
    common_name_en: 'Great Tit',
    scientific_name: 'Parus major',
    family_name: 'Paridae',
    order_name: 'Passeriformes',
    ring_size: null,
    special_kind: '',
    ...overrides,
  };
}

function setup(data: ArtennormFormDialogData) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<ArtennormFormDialogComponent>>(
    'MatDialogRef',
    ['close'],
  );
  TestBed.configureTestingModule({
    imports: [ArtennormFormDialogComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
      {provide: MatDialogRef, useValue: dialogRef},
      {provide: MAT_DIALOG_DATA, useValue: data},
    ],
  });
  const fixture: ComponentFixture<ArtennormFormDialogComponent> =
    TestBed.createComponent(ArtennormFormDialogComponent);
  const httpMock = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return {fixture, component: fixture.componentInstance, dialogRef, httpMock};
}

describe('ArtennormFormDialogComponent', () => {
  it('pre-fills the form from the effective norm in edit mode', () => {
    const {component} = setup({norm: makeNorm()});

    expect(component.isEdit).toBeTrue();
    expect(component.form.controls.weight_mean.value).toBe('9.100');
    expect(component.form.controls.weight_sd.value).toBe('0.820');
    expect(component.form.controls.sd_factor.value).toBe('1.960');
    // A null band pre-fills as blank (the check is off).
    expect(component.form.controls.feather_mean.value).toBe('');
  });

  it('saves the fixed species with the tuned values (edit mode)', () => {
    const {component, dialogRef} = setup({norm: makeNorm()});

    component.form.controls.weight_mean.setValue('12.00');
    component.form.controls.weight_sd.setValue('1.00');
    component.submit();

    const {norm} = dialogRef.close.calls.mostRecent().args[0] as ArtennormDialogResult;
    expect(norm.species_id).toBe('sp-1');
    expect(norm.weight_mean).toBe('12.00');
    expect(norm.weight_sd).toBe('1.00');
  });

  it('sends null for a cleared field, disabling just that check', () => {
    const {component, dialogRef} = setup({
      norm: makeNorm({feather_mean: '55.0', feather_sd: '1.5'}),
    });

    // Clear the Federlänge band; the Gewicht band stays set.
    component.form.controls.feather_mean.setValue('');
    component.form.controls.feather_sd.setValue('');
    component.submit();

    const {norm} = dialogRef.close.calls.mostRecent().args[0] as ArtennormDialogResult;
    expect(norm.feather_mean).toBeNull();
    expect(norm.feather_sd).toBeNull();
    expect(norm.weight_mean).toBe('9.100');
  });

  it('maps the tri-state flags to null / true / false', () => {
    const {component, dialogRef} = setup({
      norm: makeNorm({geschlechtsbestimmung_moeglich: false}),
    });

    // Pre-fills the flag to its stored "Nein"; the other flag stays "keine Prüfung".
    expect(component.form.controls.geschlechtsbestimmung_moeglich.value).toBe('false');
    component.form.controls.dj_grossgefiedermauser_moeglich.setValue('true');
    component.submit();

    const {norm} = dialogRef.close.calls.mostRecent().args[0] as ArtennormDialogResult;
    expect(norm.geschlechtsbestimmung_moeglich).toBeFalse();
    expect(norm.dj_grossgefiedermauser_moeglich).toBeTrue();
  });

  it('is an "add" dialog with a species picker when no norm is given', () => {
    const {component} = setup({});

    expect(component.isEdit).toBeFalse();
    // Submit is blocked until an Art is chosen (add-for-any-species).
    component.submit();
    expect(component.selectedSpecies()).toBeNull();
  });

  it('searches species by term and saves the chosen Art (add mode)', fakeAsync(() => {
    const {component, dialogRef, httpMock} = setup({});

    component.speciesSearch.setValue('Kohl');
    tick(300);
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/species/'));
    expect(req.request.params.get('search')).toBe('Kohl');
    req.flush({count: 1, next: null, previous: null, results: [makeSpecies()]});

    expect(component.speciesOptions().map((s) => s.id)).toEqual(['new-sp']);

    // Choosing the Art and saving posts an override for a species with no default.
    component.selectedSpecies.set(makeSpecies());
    component.form.controls.weight_mean.setValue('18.0');
    component.submit();

    const {norm} = dialogRef.close.calls.mostRecent().args[0] as ArtennormDialogResult;
    expect(norm.species_id).toBe('new-sp');
    expect(norm.weight_mean).toBe('18.0');
    httpMock.verify();
  }));

  it('pre-fills the ring size from the current override (edit mode)', () => {
    const {component} = setup({norm: makeNorm(), ringSize: RingSize.T});

    expect(component.form.controls.ring_size.value).toBe(RingSize.T);
  });

  it('includes the chosen Empfohlene Ringgröße in the result, independent of the norm', () => {
    const {component, dialogRef} = setup({norm: makeNorm()});

    component.form.controls.ring_size.setValue(RingSize.S);
    component.submit();

    const result = dialogRef.close.calls.mostRecent().args[0] as ArtennormDialogResult;
    expect(result.ringSize).toBe(RingSize.S);
    // The ring size never leaks into the whole-row norm payload (ADR 0028).
    expect('ring_size' in result.norm).toBeFalse();
  });

  it('returns a null ring size when left blank (Standard / inherit)', () => {
    const {component, dialogRef} = setup({norm: makeNorm(), ringSize: RingSize.T});

    component.form.controls.ring_size.setValue('');
    component.submit();

    const result = dialogRef.close.calls.mostRecent().args[0] as ArtennormDialogResult;
    expect(result.ringSize).toBeNull();
  });

  it('closes with no result on cancel', () => {
    const {component, dialogRef} = setup({norm: makeNorm()});

    component.cancel();

    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});

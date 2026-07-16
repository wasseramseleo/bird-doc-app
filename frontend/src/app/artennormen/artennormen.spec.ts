import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {of} from 'rxjs';

import {ArtennormenComponent} from './artennormen';
import {
  EffectiveSpeciesNorm,
  SpeciesNormOverride,
  SpeciesNormOverridePayload,
  SpeciesRingSizeOverride,
} from '../models/species-norm.model';
import {RingSize} from '../models/ring.model';
import {
  ArtennormDialogResult,
  ArtennormFormDialogData,
} from './artennorm-form-dialog/artennorm-form-dialog';
import {ConfirmDialogData} from '../shared/confirm-dialog/confirm-dialog';

let httpMock: HttpTestingController;

function page0<T>(results: T[]) {
  return {count: results.length, next: null, previous: null, results};
}

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

function makeOverride(overrides: Partial<SpeciesNormOverride> = {}): SpeciesNormOverride {
  return {...makeNorm(), id: 'ov-1', ...overrides} as SpeciesNormOverride;
}

function makeRingOverride(
  overrides: Partial<SpeciesRingSizeOverride> = {},
): SpeciesRingSizeOverride {
  return {
    id: 'rov-1',
    species_id: 'sp-1',
    species_name: 'Zaunkönig',
    ring_size: RingSize.S,
    ...overrides,
  };
}

// A dialog result: the norm payload plus the chosen Empfohlene Ringgröße
// (default null = Standard/inherit), resolved independently (ADR 0028).
function dialogResult(
  norm: SpeciesNormOverridePayload,
  ringSize: RingSize | null = null,
): ArtennormDialogResult {
  return {norm, ringSize};
}

// ngOnInit loads the effective norms (GET /species-norms/), the org norm
// overrides (GET /species-norm-overrides/) and the org ring-size overrides
// (GET /species-ring-size-overrides/); a load must satisfy all three.
function flushLoad(
  norms: EffectiveSpeciesNorm[],
  overrides: SpeciesNormOverride[] = [],
  ringOverrides: SpeciesRingSizeOverride[] = [],
) {
  httpMock
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/species-norms/'))
    .flush({norms});
  httpMock
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/species-norm-overrides/'))
    .flush(page0(overrides));
  httpMock
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/species-ring-size-overrides/'))
    .flush(page0(ringOverrides));
}

function setup() {
  TestBed.configureTestingModule({
    imports: [ArtennormenComponent],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
  });
  const fixture: ComponentFixture<ArtennormenComponent> =
    TestBed.createComponent(ArtennormenComponent);
  httpMock = TestBed.inject(HttpTestingController);
  return {fixture, component: fixture.componentInstance};
}

function spyOnSnackBar(fixture: ComponentFixture<ArtennormenComponent>) {
  return spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
}

function spyOnDialog(fixture: ComponentFixture<ArtennormenComponent>, afterClosed: unknown) {
  return spyOn(fixture.debugElement.injector.get(MatDialog), 'open').and.returnValue({
    afterClosed: () => of(afterClosed),
  } as never);
}

describe('ArtennormenComponent', () => {
  afterEach(() => httpMock.verify());

  it('marks each Art Standard or angepasst from the effective + override join', () => {
    const {fixture} = setup();

    fixture.detectChanges(); // ngOnInit → load()
    flushLoad(
      [
        makeNorm({species_id: 'sp-1', species_name: 'Amsel'}),
        makeNorm({species_id: 'sp-2', species_name: 'Zaunkönig'}),
      ],
      // Only sp-2 is overridden — it must read "angepasst", sp-1 "Standard".
      [makeOverride({id: 'ov-2', species_id: 'sp-2', species_name: 'Zaunkönig'})],
    );
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.norm-card');
    expect(cards.length).toBe(2);

    const names = Array.from(fixture.nativeElement.querySelectorAll('.norm-card__name')).map((e) =>
      (e as HTMLElement).textContent?.trim(),
    );
    expect(names).toEqual(['Amsel', 'Zaunkönig']);

    const standard = fixture.nativeElement.querySelector('.norm-card__badge--standard');
    const angepasst = fixture.nativeElement.querySelector('.norm-card__badge--override');
    expect(standard?.textContent).toContain('Standard');
    expect(angepasst?.textContent).toContain('angepasst');
  });

  it('offers "Auf Standard zurücksetzen" only for an angepasst Art', () => {
    const {fixture} = setup();

    fixture.detectChanges();
    flushLoad(
      [makeNorm({species_id: 'sp-1', species_name: 'Amsel'})],
      [], // sp-1 is Standard: no reset action.
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('button[aria-label="Auf Standard zurücksetzen"]'),
    ).toBeNull();
  });

  it('shows an empty state when no Artennorm is in force', () => {
    const {fixture} = setup();

    fixture.detectChanges();
    flushLoad([], []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.norm-card')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('keine Artennormen');
  });

  it('adds an override from the dialog via POST /species-norm-overrides/ and reloads', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    const payload: SpeciesNormOverridePayload = {
      species_id: 'new-sp',
      weight_mean: '18.0',
    } as SpeciesNormOverridePayload;
    const dialogSpy = spyOnDialog(fixture, dialogResult(payload));

    component.openAddDialog();

    // The add dialog is opened with no norm pre-selected (add-for-any-species).
    const config = dialogSpy.calls.mostRecent().args[1] as {data: ArtennormFormDialogData};
    expect(config.data.norm).toBeUndefined();

    const post = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/species-norm-overrides/'),
    );
    expect(post.request.body).toEqual(payload);
    post.flush(makeOverride({id: 'ov-new', species_id: 'new-sp', species_name: 'Kohlmeise'}));

    // A successful save reloads all three lists.
    flushLoad([makeNorm({species_id: 'new-sp', species_name: 'Kohlmeise'})]);
  });

  it('edits an Art via the dialog pre-filled with its effective norm, then POSTs and reloads', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    const norm = makeNorm({species_id: 'sp-1', species_name: 'Amsel'});
    const payload: SpeciesNormOverridePayload = {
      species_id: 'sp-1',
      weight_mean: '12.0',
    } as SpeciesNormOverridePayload;
    const dialogSpy = spyOnDialog(fixture, dialogResult(payload));

    component.openEditDialog({
      species_id: 'sp-1',
      species_name: 'Amsel',
      is_override: false,
      override_id: null,
      norm,
    });

    // The per-species dialog is pre-filled from the effective norm.
    const config = dialogSpy.calls.mostRecent().args[1] as {data: ArtennormFormDialogData};
    expect(config.data.norm).toBe(norm);

    const post = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/species-norm-overrides/'),
    );
    expect(post.request.body).toEqual(payload);
    post.flush(makeOverride({id: 'ov-1', species_id: 'sp-1', species_name: 'Amsel'}));

    flushLoad([makeNorm({species_id: 'sp-1', species_name: 'Amsel'})]);
  });

  it('pre-fills the dialog with the current Empfohlene-Ringgröße override', () => {
    const {fixture, component} = setup();

    // Load a species that carries a ring-size override so the map is populated.
    fixture.detectChanges();
    flushLoad(
      [makeNorm({species_id: 'sp-1', species_name: 'Amsel'})],
      [],
      [makeRingOverride({id: 'rov-1', species_id: 'sp-1', ring_size: RingSize.T})],
    );
    fixture.detectChanges();

    const dialogSpy = spyOnDialog(fixture, undefined); // cancelled, no writes
    component.openEditDialog({
      species_id: 'sp-1',
      species_name: 'Amsel',
      is_override: false,
      override_id: null,
      norm: makeNorm({species_id: 'sp-1', species_name: 'Amsel'}),
    });

    const config = dialogSpy.calls.mostRecent().args[1] as {data: ArtennormFormDialogData};
    expect(config.data.ringSize).toBe(RingSize.T);
  });

  it('upserts a chosen ring size via POST /species-ring-size-overrides/ alongside the norm', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    const payload: SpeciesNormOverridePayload = {
      species_id: 'sp-1',
      weight_mean: '12.0',
    } as SpeciesNormOverridePayload;
    spyOnDialog(fixture, dialogResult(payload, RingSize.S));

    component.openEditDialog({
      species_id: 'sp-1',
      species_name: 'Amsel',
      is_override: false,
      override_id: null,
      norm: makeNorm({species_id: 'sp-1', species_name: 'Amsel'}),
    });

    // The norm override and the ring-size override are written independently.
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/species-norm-overrides/'))
      .flush(makeOverride({id: 'ov-1', species_id: 'sp-1', species_name: 'Amsel'}));
    const ringPost = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/species-ring-size-overrides/'),
    );
    expect(ringPost.request.body).toEqual({species_id: 'sp-1', ring_size: RingSize.S});
    ringPost.flush(makeRingOverride({species_id: 'sp-1', ring_size: RingSize.S}));

    flushLoad([makeNorm({species_id: 'sp-1', species_name: 'Amsel'})]);
  });

  it('resets the ring size to Standard via DELETE when blanked on an existing override', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);

    // Seed the map with an existing ring override for sp-1.
    fixture.detectChanges();
    flushLoad(
      [makeNorm({species_id: 'sp-1', species_name: 'Amsel'})],
      [],
      [makeRingOverride({id: 'rov-1', species_id: 'sp-1', ring_size: RingSize.T})],
    );
    fixture.detectChanges();

    const payload: SpeciesNormOverridePayload = {
      species_id: 'sp-1',
      weight_mean: '12.0',
    } as SpeciesNormOverridePayload;
    spyOnDialog(fixture, dialogResult(payload, null)); // ring size blanked

    component.openEditDialog({
      species_id: 'sp-1',
      species_name: 'Amsel',
      is_override: false,
      override_id: null,
      norm: makeNorm({species_id: 'sp-1', species_name: 'Amsel'}),
    });

    httpMock
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/species-norm-overrides/'))
      .flush(makeOverride({id: 'ov-1', species_id: 'sp-1', species_name: 'Amsel'}));
    // Blanking an existing ring override resets it to the global default.
    httpMock
      .expectOne(
        (r) => r.method === 'DELETE' && r.url.endsWith('/species-ring-size-overrides/rov-1/'),
      )
      .flush(null, {status: 204, statusText: 'No Content'});

    flushLoad([makeNorm({species_id: 'sp-1', species_name: 'Amsel'})]);
  });

  it('resets an override after confirmation via DELETE and reloads', () => {
    const {fixture, component} = setup();
    spyOnSnackBar(fixture);
    const dialogSpy = spyOnDialog(fixture, true); // confirm the reset

    component.openResetDialog({
      species_id: 'sp-2',
      species_name: 'Zaunkönig',
      is_override: true,
      override_id: 'ov-2',
      norm: makeNorm({species_id: 'sp-2', species_name: 'Zaunkönig'}),
    });

    // The confirm names the Art and that it returns to the Standard-Artennorm.
    const config = dialogSpy.calls.mostRecent().args[1] as {data: ConfirmDialogData};
    expect(config.data.message).toContain('Zaunkönig');
    expect(config.data.message).toContain('Standard');

    const del = httpMock.expectOne(
      (r) => r.method === 'DELETE' && r.url.endsWith('/species-norm-overrides/ov-2/'),
    );
    del.flush(null, {status: 204, statusText: 'No Content'});

    // A successful reset reloads both lists.
    flushLoad([makeNorm({species_id: 'sp-2', species_name: 'Zaunkönig'})]);
  });

  it('does not reset when the confirmation is cancelled', () => {
    const {fixture, component} = setup();
    const dialogSpy = spyOnDialog(fixture, false); // cancel

    component.openResetDialog({
      species_id: 'sp-2',
      species_name: 'Zaunkönig',
      is_override: true,
      override_id: 'ov-2',
      norm: makeNorm({species_id: 'sp-2', species_name: 'Zaunkönig'}),
    });

    // Warning shown, but a cancelled reset makes no DELETE and no reload —
    // httpMock.verify() (afterEach) would fail on any unexpected request.
    expect(dialogSpy).toHaveBeenCalled();
  });
});

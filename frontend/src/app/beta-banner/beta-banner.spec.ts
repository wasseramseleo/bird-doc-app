import {ComponentFixture, TestBed} from '@angular/core/testing';

import {BetaBanner} from './beta-banner';

/** Renders a fresh BetaBanner instance — a second call models a later login. */
function login(): ComponentFixture<BetaBanner> {
  const fixture = TestBed.createComponent(BetaBanner);
  fixture.detectChanges();
  return fixture;
}

function setup(): ComponentFixture<BetaBanner> {
  TestBed.configureTestingModule({imports: [BetaBanner]});
  return login();
}

describe('BetaBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows the banner on first login (nothing dismissed yet)', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.beta-banner'))
      .withContext('banner shown by default')
      .not.toBeNull();
  });

  it('explains the beta status and the future per-Organisation pricing', () => {
    const text = setup().nativeElement.querySelector('.beta-banner')!.textContent as string;

    expect(text).withContext('names the beta').toContain('Beta');
    expect(text).withContext('states it is free now').toContain('kostenlos');
    expect(text).withContext('pre-announces the 1.0 licence').toContain('1.0');
    expect(text).withContext('pricing is per Organisation').toContain('Organisation');
  });

  it('hides the banner once dismissed', () => {
    const fixture = setup();

    const dismiss = fixture.nativeElement.querySelector('.beta-banner__dismiss') as HTMLElement;
    expect(dismiss).withContext('dismiss control').not.toBeNull();
    dismiss.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.beta-banner'))
      .withContext('banner gone after dismissal')
      .toBeNull();
  });

  it('does not reappear on a later login once dismissed (persists the dismissal)', () => {
    const first = setup();
    (first.nativeElement.querySelector('.beta-banner__dismiss') as HTMLElement).click();
    first.detectChanges();

    // A subsequent login renders a brand-new banner instance.
    const next = login();

    expect(next.nativeElement.querySelector('.beta-banner'))
      .withContext('stays dismissed across logins')
      .toBeNull();
  });

  it('never shows for a returning user who already dismissed it', () => {
    localStorage.setItem('birddoc.betaBannerDismissed', 'true');

    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.beta-banner'))
      .withContext('no banner when storage says it was dismissed')
      .toBeNull();
  });
});

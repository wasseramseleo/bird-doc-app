import {TestBed} from '@angular/core/testing';
import {OverlayContainer} from '@angular/cdk/overlay';
import {MatDialog, MatDialogRef} from '@angular/material/dialog';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {firstValueFrom} from 'rxjs';

import {InfoDialogComponent, InfoDialogData} from './info-dialog';
import {ConfirmDialogComponent, ConfirmDialogData} from '../confirm-dialog/confirm-dialog';

/**
 * InfoDialogComponent is the purely-informational single-button modal from
 * PRD #261 (issue #263): it surfaces a Plausibilitätswarnung with one
 * „Verstanden" button, auto-focused so Enter dismisses it, and resolves with no
 * confirm/cancel boolean — it is not a save gate. These specs open it through
 * the real MatDialog + CDK overlay (not a mocked ref) so the CDK's auto-focus
 * and the DOM the Beringer actually sees are exercised.
 */
describe('InfoDialogComponent', () => {
  let dialog: MatDialog;
  let overlay: OverlayContainer;

  /** Lets the CDK render/close the overlay and settle focus (real zone). */
  function settle(): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve));
  }

  function container(): HTMLElement {
    return overlay.getContainerElement();
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(container().querySelectorAll('button'));
  }

  /** Waits (a few frames) until `el` owns focus, so the assertion isn't racy. */
  async function waitForFocus(el: HTMLElement): Promise<void> {
    for (let i = 0; i < 20 && document.activeElement !== el; i++) {
      await settle();
    }
  }

  async function openInfo(
    data: Partial<InfoDialogData> = {},
  ): Promise<MatDialogRef<InfoDialogComponent, void>> {
    const ref = dialog.open<InfoDialogComponent, InfoDialogData, void>(InfoDialogComponent, {
      data: {
        title: 'Plausibilitätswarnung',
        message: 'Gewicht 99 g liegt außerhalb des erwarteten Bereichs (10–20 g).',
        ...data,
      },
    });
    await settle();
    return ref;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideNoopAnimations()],
    });
    dialog = TestBed.inject(MatDialog);
    overlay = TestBed.inject(OverlayContainer);
  });

  afterEach(() => {
    dialog.closeAll();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('shows the title and arbitrary message it is opened with', async () => {
    await openInfo({
      title: 'Plausibilitätswarnung',
      message: 'Flügellänge 40 mm liegt außerhalb des erwarteten Bereichs (60–70 mm).',
    });

    expect(container().textContent).toContain('Plausibilitätswarnung');
    expect(container().textContent).toContain(
      'Flügellänge 40 mm liegt außerhalb des erwarteten Bereichs (60–70 mm).',
    );
  });

  it('renders exactly one action button labelled „Verstanden" (no cancel/Abbrechen)', async () => {
    await openInfo();

    const btns = buttons();
    expect(btns.length).toBe(1);
    expect(btns[0].textContent?.trim()).toBe('Verstanden');
    expect(container().textContent).not.toContain('Abbrechen');
  });

  it('auto-focuses the „Verstanden" button on open', async () => {
    await openInfo();

    const button = buttons()[0];
    await waitForFocus(button);

    expect(document.activeElement).toBe(button);
  });

  it('dismisses when the auto-focused button is activated — as pressing Enter does — resolving without any confirm/cancel boolean', async () => {
    const ref = await openInfo();
    const button = buttons()[0];
    await waitForFocus(button);
    // The sole button owns focus, so a native Enter keypress activates (clicks)
    // it. Exercise that activation on whatever element currently holds focus.
    expect(document.activeElement).toBe(button);

    const closed = firstValueFrom(ref.afterClosed());
    (document.activeElement as HTMLElement).click();
    const result = await closed;

    // Informational, not a gate: no `true`/`false` is threaded back to the caller.
    expect(result).toBeUndefined();
    await settle();
    expect(container().querySelector('app-info-dialog')).toBeNull();
  });

  it('leaves the shared two-button ConfirmDialogComponent unchanged (Abbrechen + confirm)', async () => {
    dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      data: {title: 'Eintrag löschen?', message: 'Diesen Eintrag wirklich löschen?'},
    });
    await settle();

    const btns = buttons();
    expect(btns.length).toBe(2);
    expect(container().textContent).toContain('Abbrechen');
  });
});

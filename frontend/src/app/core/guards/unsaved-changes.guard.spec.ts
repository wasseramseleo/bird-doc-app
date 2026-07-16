import {TestBed} from '@angular/core/testing';
import {MatDialog} from '@angular/material/dialog';
import {Observable, firstValueFrom, of} from 'rxjs';

import {unsavedChangesGuard} from './unsaved-changes.guard';
import {UnsavedChangesService} from '../../service/unsaved-changes.service';

const dialogMock = {open: jasmine.createSpy('open')};

function runGuard(): Promise<boolean> {
  const result = TestBed.runInInjectionContext(() =>
    unsavedChangesGuard(null as never, null as never, null as never, null as never),
  ) as Observable<boolean>;
  return firstValueFrom(result);
}

/** Stands in for the capture form publishing its dirty state (ADR 0032). */
function midCapture(dirty: boolean): void {
  TestBed.inject(UnsavedChangesService).watch(() => dirty);
}

describe('unsavedChangesGuard', () => {
  beforeEach(() => {
    dialogMock.open.calls.reset();
    dialogMock.open.and.returnValue({afterClosed: () => of(true)});
    TestBed.configureTestingModule({
      providers: [{provide: MatDialog, useValue: dialogMock}],
    });
  });

  it('lets a navigation through when nobody is mid-capture', async () => {
    await expectAsync(runGuard()).toBeResolvedTo(true);
    expect(dialogMock.open).not.toHaveBeenCalled();
  });

  it('lets a navigation through when the capture form is untouched (no question asked)', async () => {
    midCapture(false);

    await expectAsync(runGuard()).toBeResolvedTo(true);
    expect(dialogMock.open).withContext('pristine form is never asked about').not.toHaveBeenCalled();
  });

  // The guard's own contract, against a stand-in probe: whatever triggered the
  // navigation, a touched capture form is asked about first.
  //
  // This is deliberately *not* the `n` regression test, and a probe installed by
  // hand here could not be: it exercises neither `app.ts`, nor the router, nor
  // the form. Those live where they can fail for real — `app.spec.ts` drives the
  // whole `n` → router → guard path, and `data-entry-form.spec.ts` covers the
  // form actually publishing its dirty state (issue #339 + ADR 0032).
  it('blocks the navigation away from a touched capture form when the Beringer declines', async () => {
    midCapture(true);
    dialogMock.open.and.returnValue({afterClosed: () => of(false)});

    await expectAsync(runGuard()).toBeResolvedTo(false);
    expect(dialogMock.open).toHaveBeenCalled();
  });

  it('leaves a touched capture form once the Beringer confirms discarding the input', async () => {
    midCapture(true);
    dialogMock.open.and.returnValue({afterClosed: () => of(true)});

    await expectAsync(runGuard()).toBeResolvedTo(true);
  });

  // A dialog dismissed with Escape closes with `undefined`, which must read as
  // "stay" — never as permission to throw the input away.
  it('stays on the form when the confirmation is dismissed without an answer', async () => {
    midCapture(true);
    dialogMock.open.and.returnValue({afterClosed: () => of(undefined)});

    await expectAsync(runGuard()).toBeResolvedTo(false);
  });

  it('stops asking once the capture form is gone', async () => {
    const service = TestBed.inject(UnsavedChangesService);
    const probe = () => true;
    service.watch(probe);
    service.stopWatching(probe);

    await expectAsync(runGuard()).toBeResolvedTo(true);
    expect(dialogMock.open).not.toHaveBeenCalled();
  });
});

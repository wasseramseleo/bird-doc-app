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

  // Issue #339 + ADR 0032: the bare `n` shortcut navigates to a fresh capture
  // form from anywhere. This is its regression test — leaving a touched form now
  // has to ask first, whatever triggered the navigation.
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

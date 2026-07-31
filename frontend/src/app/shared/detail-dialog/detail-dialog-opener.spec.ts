import {TestBed} from '@angular/core/testing';
import {MatDialog} from '@angular/material/dialog';

import {DataEntryDetailDialogComponent} from './data-entry-detail-dialog';
import {DetailDialogOpener} from './detail-dialog-opener';
import {DataEntry} from '../../models/data-entry.model';

/**
 * #478 (ADR 0042): die Dialog-Konfiguration steht nur noch hier — vorher
 * wortgleich in `DataEntryFormComponent.openDetailDialog()` und
 * `TodaySessionComponent.openSynced()`. Die beiden Maße sind bekannt-gute
 * Literale aus der abgelösten Kopie, hier nicht nachgerechnet.
 */
describe('DetailDialogOpener', () => {
  let dialog: jasmine.SpyObj<MatDialog>;
  let opener: DetailDialogOpener;

  const fang = {id: 'fang-1'} as unknown as DataEntry;

  beforeEach(() => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    TestBed.configureTestingModule({
      providers: [{provide: MatDialog, useValue: dialog}],
    });
    opener = TestBed.inject(DetailDialogOpener);
  });

  it('öffnet den Detail-Dialog zu genau diesem Fang', () => {
    opener.open(fang);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    const [komponente, config] = dialog.open.calls.mostRecent().args as [
      unknown,
      {data: DataEntry; width: string; maxHeight: string},
    ];
    expect(komponente).toBe(DataEntryDetailDialogComponent);
    expect(config.data).toBe(fang);
  });

  it('trägt die Dialog-Konfiguration als einzige Stelle', () => {
    opener.open(fang);

    const config = dialog.open.calls.mostRecent().args[1] as {
      width: string;
      maxHeight: string;
    };
    expect(config.width).toBe('640px');
    expect(config.maxHeight).toBe('90vh');
  });
});

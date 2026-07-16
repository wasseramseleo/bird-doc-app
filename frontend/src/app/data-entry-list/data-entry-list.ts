import {ChangeDetectionStrategy, Component, DestroyRef, OnInit, effect, inject, signal, untracked} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Router} from '@angular/router';
import {FormControl, ReactiveFormsModule} from '@angular/forms';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatTableModule} from '@angular/material/table';
import {MatPaginatorModule, PageEvent} from '@angular/material/paginator';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatBadgeModule} from '@angular/material/badge';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog} from '@angular/material/dialog';
import {debounceTime, distinctUntilChanged} from 'rxjs/operators';

import {ApiService} from '../service/api.service';
import {ProjectService} from '../service/project.service';
import {BirdStatus, DataEntry} from '../models/data-entry.model';
import {
  ImportIwmDialogComponent,
  ImportIwmDialogData,
} from './import-iwm-dialog/import-iwm-dialog';

@Component({
  selector: 'app-data-entry-list',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './data-entry-list.html',
  styleUrl: './data-entry-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataEntryListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);

  readonly currentProject = this.projectService.currentProject;

  readonly loading = signal<boolean>(false);
  readonly error = signal<boolean>(false);
  readonly entries = signal<DataEntry[]>([]);
  readonly total = signal<number>(0);

  // Server-side pagination state. MatPaginator is zero-based; the API is one-based.
  readonly pageIndex = signal<number>(0);
  // #374 (#2): the "Letzte Fänge" list defaults to 50 rows so a Beringer sees a
  // full session at a glance; the 10/50/100 options are unchanged and nothing is
  // persisted.
  readonly pageSize = signal<number>(50);
  readonly pageSizeOptions = [10, 50, 100];

  readonly searchControl = new FormControl('', {nonNullable: true});

  readonly BirdStatus = BirdStatus;
  readonly displayedColumns: string[] = [
    'created', 'date_time', 'ring', 'species', 'bird_status', 'staff',
    'tarsus', 'feather_span', 'wing_span', 'weight_gram',
  ];

  constructor() {
    // Reactive load: tracks only the active Projekt. It runs once on first
    // render (the initial load) and again on every switch — including switches
    // that reuse this same route/component instance, where ngOnInit won't fire.
    // On switch we reset paging and clear the search so the new Projekt starts
    // from a clean first page. The body is untracked so the paging/search reads
    // inside loadEntries() don't re-trigger this effect.
    effect(() => {
      const project = this.currentProject();
      untracked(() => {
        if (!project) {
          return;
        }
        this.pageIndex.set(0);
        this.searchControl.setValue('', {emitEvent: false});
        this.loadEntries();
      });
    });
  }

  ngOnInit(): void {
    if (!this.currentProject()) {
      this.router.navigateByUrl('/');
      return;
    }

    // Debounced species search; any change resets to the first page.
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pageIndex.set(0);
        this.loadEntries();
      });
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.loadEntries();
  }

  openEntry(entry: DataEntry): void {
    this.router.navigate(['/data-entry', entry.id]);
  }

  newEntry(): void {
    this.router.navigateByUrl('/data-entry');
  }

  // Import lives where the Admin already looks at a Projekt's captures. It is
  // gated on a selected Projekt (imported captures need an unambiguous Projekt to
  // land in); Admin-only is enforced server-side, mirroring the IWM export — the
  // frontend has no Rolle signal today. The dialog resolves to true once a commit
  // wrote captures, so we refresh the list; a cancel resolves false and writes
  // nothing.
  openImport(): void {
    const project = this.currentProject();
    if (!project) {
      return;
    }
    const ref = this.dialog.open<ImportIwmDialogComponent, ImportIwmDialogData, boolean>(
      ImportIwmDialogComponent,
      {data: {projectId: project.id, projectTitle: project.title}},
    );
    ref.afterClosed().subscribe((committed) => {
      if (committed) {
        this.pageIndex.set(0);
        this.loadEntries();
      }
    });
  }

  private loadEntries(): void {
    const project = this.currentProject();
    if (!project) {
      return;
    }
    this.loading.set(true);
    this.error.set(false);
    this.api
      .getDataEntries({
        projectId: project.id,
        page: this.pageIndex() + 1,
        pageSize: this.pageSize(),
        search: this.searchControl.value.trim() || undefined,
      })
      .subscribe({
        next: (response) => {
          this.entries.set(response.results);
          this.total.set(response.count);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }
}

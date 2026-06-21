import {ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal} from '@angular/core';
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
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {debounceTime, distinctUntilChanged} from 'rxjs/operators';

import {ApiService} from '../service/api.service';
import {ProjectService} from '../service/project.service';
import {BirdStatus, DataEntry} from '../models/data-entry.model';

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

  readonly currentProject = this.projectService.currentProject;

  readonly loading = signal<boolean>(false);
  readonly error = signal<boolean>(false);
  readonly entries = signal<DataEntry[]>([]);
  readonly total = signal<number>(0);

  // Server-side pagination state. MatPaginator is zero-based; the API is one-based.
  readonly pageIndex = signal<number>(0);
  readonly pageSize = signal<number>(10);
  readonly pageSizeOptions = [10, 50, 100];

  readonly searchControl = new FormControl('', {nonNullable: true});

  readonly BirdStatus = BirdStatus;
  readonly displayedColumns: string[] = [
    'created', 'date_time', 'ring', 'species', 'bird_status', 'staff',
    'tarsus', 'feather_span', 'wing_span', 'weight_gram',
  ];

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

    this.loadEntries();
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

import {ChangeDetectionStrategy, Component, OnInit, computed, inject, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';

import {ApiService} from '../service/api.service';
import {Beringer} from '../models/beringer.model';

@Component({
  selector: 'app-beringer',
  imports: [MatIconModule, MatProgressSpinnerModule, MatSnackBarModule],
  templateUrl: './beringer.html',
  styleUrl: './beringer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BeringerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal<boolean>(true);
  private readonly beringer = signal<Beringer[]>([]);

  // Surname, then first name (falling back to the Kürzel for a stable order when
  // a name is blank), so the management list reads predictably regardless of the
  // order the server returns.
  readonly sortedBeringer = computed(() =>
    [...this.beringer()].sort(
      (a, b) =>
        a.last_name.localeCompare(b.last_name) ||
        a.first_name.localeCompare(b.first_name) ||
        a.handle.localeCompare(b.handle),
    ),
  );

  // Account-linked Beringer wear a "Mitglied" badge; the rest are "Ohne Konto".
  isMitglied(beringer: Beringer): boolean {
    return beringer.is_member === true;
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.getBeringer().subscribe({
      next: (res) => {
        this.beringer.set(res.results);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Beringer konnten nicht geladen werden.', 'Schließen', {duration: 3000});
      },
    });
  }
}

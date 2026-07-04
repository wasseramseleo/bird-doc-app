import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {Router, RouterOutlet} from '@angular/router';
import {NavBar} from './nav-bar/nav-bar';
import {BetaBanner} from './beta-banner/beta-banner';
import {AuthService} from './service/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavBar, BetaBanner],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Issue #339: the app's first app-wide keyboard shortcut. A single
  // document-level keydown handler in the shell so plain `n` opens a fresh
  // capture form from anywhere.
  host: {
    '(document:keydown)': 'onGlobalKeydown($event)',
  },
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Plain `n` (no modifier) opens a fresh capture form — the most common action,
  // one keystroke away. Guarded so it is inert while the user is typing into an
  // editable control; Strg+N / Cmd+N stay browser-reserved and are ignored.
  onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key !== 'n' || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (this.isEditableTarget()) {
      return;
    }
    event.preventDefault();
    this.router.navigateByUrl('/data-entry');
  }

  // The shortcut must never hijack a keystroke meant for a form field: it is
  // inert whenever focus is in an input, textarea, select, or a contentEditable
  // element.
  private isEditableTarget(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
      return false;
    }
    const tag = active.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      active.isContentEditable
    );
  }
}

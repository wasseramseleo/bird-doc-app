import {Injectable, signal} from '@angular/core';

/**
 * #392 (ADR 0030): der Rückkanal vom „Rückgängig" des Lösch-Snackbars zur
 * „Letzte Fänge"-Liste.
 *
 * Das Löschen navigiert zur Liste, die daraufhin EINMAL lädt — ohne den
 * gelöschten Eintrag. Das Snackbar überlebt diese Navigation bewusst (die
 * Erfassungsmaske ist da schon zerstört), also kommt das erfolgreiche Restore
 * an, wenn die Liste längst gerendert ist: ohne Kanal bliebe der
 * wiederhergestellte Fang unsichtbar, während die Bestätigung behauptet, er sei
 * zurück. Wer das sieht, erfasst ihn plausibel erneut — und ADR 0019 verlangt
 * genau eine lebende Erstfang-Zeile pro Ringnummer.
 *
 * Deshalb ein Zähler statt eines Booleans: jedes `request()` ist ein eigenes,
 * unterscheidbares Ereignis, auch zwei kurz hintereinander. Die Liste hält den
 * zuletzt gesehenen Stand und lädt nur bei einer echten Änderung nach — ihr
 * erster Effect-Lauf ist damit kein zweiter Ladevorgang.
 */
@Injectable({providedIn: 'root'})
export class DataEntryRefreshService {
  private readonly _token = signal<number>(0);

  /** Steigt bei jedem `request()`. Nur der Wechsel zählt, nie der Wert selbst. */
  readonly token = this._token.asReadonly();

  /** Meldet, dass die serverseitigen Fänge sich geändert haben. */
  request(): void {
    this._token.update((n) => n + 1);
  }
}

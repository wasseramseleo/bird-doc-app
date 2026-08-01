import {Injectable, inject} from '@angular/core';
import {Router} from '@angular/router';

/**
 * #492: „navigiere zu diesem Fang, und wecke dabei den Wächter" — die eine
 * Einheit, die den **Wächter-Umweg** kennt, und die einzige Stelle, an der er
 * steht.
 *
 * Zu einem Fang zu navigieren ist in dieser App nicht trivial, und der Grund
 * dafür ist eine Eigenschaft des Routers: der `unsavedChangesGuard` (#407,
 * ADR 0032) läuft **nicht**, wenn von einem geöffneten Fang zu einem anderen
 * gewechselt wird. `/data-entry/:a` → `/data-entry/:b` ist für den Router
 * dieselbe Route mit einer anderen Id; er verwendet das Bauteil wieder und ruft
 * `canDeactivate` nie auf. Eine Navigation, die das nicht berücksichtigt, wirft
 * entweder eine angefangene Erfassung still weg oder tut wortlos gar nichts.
 *
 * Die Gegenmaßnahme ist der **Zwischenschritt über die leere Erfassungsmaske**
 * — das Verlassen, das die Route sonst verschluckt: dort fragt der Wächter, und
 * was er ablehnt, wird auch nicht geöffnet. In der Verlaufsgeschichte des
 * Browsers steht er nicht (`skipLocationChange`), denn er ist kein Bildschirm,
 * den jemand aufgesucht hätte — ein Schritt zurück führt dorthin, wo die
 * Beringer:in herkam.
 *
 * Der Umweg ist **eng**: steht kein Fang offen, wird direkt navigiert. Sonst
 * stellte der Wächter beim Verlassen der leeren Maske eine Frage über eine
 * Erfassung, die es gar nicht gibt — und seine Ablehnung ließe die Beringer:in
 * auf einem leeren Formular stehen statt auf ihrem Fang.
 *
 * Herausgezogen aus „Erstfang öffnen" des Fehler-Banners (#444), wo er zuerst
 * gebraucht wurde. Er steht hier, damit der nächste Aufrufer — der
 * „Bearbeiten"-Knopf des Detail-Dialogs (PRD #491) — keine wortgleiche zweite
 * Kopie einer Regel bekommt, die schon einmal übersehen wurde.
 */
@Injectable({providedIn: 'root'})
export class FangNavigation {
  private readonly router = inject(Router);

  /**
   * Öffnet den Fang mit dieser Id — die gewöhnliche Navigation zu einem Fang,
   * genau die, die auch „Letzte Fänge" und „Heute" benutzen, nur um den
   * Zwischenschritt ergänzt.
   *
   * Die Id ist die eines Fangs, wie ihn `/data-entry/:id` versteht: die des
   * Server-Datensatzes oder die eines noch eingereihten Eintrags (#163).
   *
   * Antwortet mit `true`, wenn der Zielfang offen steht, und mit `false`, wo
   * der Wächter das Verwerfen abgelehnt hat — dann bleibt der Fang stehen, der
   * schon offen war.
   */
  async zumFang(fangId: string): Promise<boolean> {
    if (this.router.url.startsWith('/data-entry/')) {
      const verlassen = await this.router.navigateByUrl('/data-entry', {
        skipLocationChange: true,
      });
      if (!verlassen) {
        return false;
      }
    }
    return this.router.navigate(['/data-entry', fangId]);
  }
}

import {Directive, ElementRef, inject} from '@angular/core';

/**
 * #496 (PRD #491): was eine **Fang-Zeile** tastaturbedienbar macht — an einer
 * Stelle, für alle drei Fang-Tabellen („Letzte Fänge", die Wiederfang-Historie
 * und beide Abschnitte von „Heute").
 *
 * **Warum das kein Zusatz ist, sondern der Preis der neuen Regel:** seit #494
 * ist der Zeilenklick der Leseweg *jedes* Fangs. Der einzige Tastaturweg in den
 * Detail-Dialog war bis dahin das **Detail-Zeichen** (ⓘ) — und das erscheint
 * nur bei Brutfleck, CPL+ oder einer Bemerkung (#468). Ein gewöhnlicher Fang,
 * also die Mehrzahl aller Fänge, hätte damit **gar keinen** Tastaturweg zu
 * seinem Detail-Dialog.
 *
 * Die Zeile bekommt deshalb
 *
 *   * einen **Tabulator-Halt** (`tabindex="0"`),
 *   * eine **Rolle**, die sie einem Screenreader als bedienbar ankündigt, und
 *   * **Enter und Leertaste**, die genau das auslösen, was der Zeiger auslöst.
 *
 * Ausgelöst wird über einen Klick auf die Zeile selbst, nicht über einen
 * eigenen Ausgang. Damit gibt es **eine** Wirkung und **einen** Weg: was ein
 * Tipp bedeutet, entscheidet weiterhin allein die Tabelle über ihr
 * `(click)`-Binding, und Zeiger und Tastatur können nicht auseinanderlaufen.
 *
 * **Die Rolle ist eine bewusste Abwägung.** Auf den beiden Material-Tabellen
 * überschreibt `role="button"` das `role="row"`, das `MatRow` setzt: die Zeile
 * ist hier tatsächlich das bedienbare Element, und ein Halt ohne Ansage wäre
 * für eine Beringer:in am Screenreader kein Weg, sondern eine Sackgasse. Die
 * Zellen behalten ihre Spaltenüberschriften als sichtbare Tabelle; was verloren
 * geht, ist die Zeilen-Navigation des Screenreaders, was gewonnen wird, ist der
 * einzige Leseweg eines gewöhnlichen Fangs.
 *
 * **Ein Tastendruck *in* der Zeile gehört nicht der Zeile.** Der Lösch-Knopf in
 * „Heute" bleibt eigenständig bedienbar: sein Tastendruck steigt zwar auf wie
 * jedes andere Ereignis, wird hier aber ignoriert, weil er nicht der Zeile
 * galt. Sonst hieße Löschen mit der Tastatur auch Lesen.
 */
@Directive({
  selector: '[appFangZeile]',
  host: {
    // Als Bindung, nicht als statisches Attribut: `MatRow` bringt ein statisches
    // `role="row"` mit, und eine Bindung wird verlässlich danach angewandt.
    '[attr.tabindex]': '"0"',
    '[attr.role]': '"button"',
    '(keydown)': 'onKeydown($event)',
  },
})
export class FangZeileDirective {
  private readonly zeile = inject<ElementRef<HTMLElement>>(ElementRef);

  onKeydown(event: KeyboardEvent): void {
    // Der Tastendruck galt einem Knopf *in* der Zeile (Löschen in „Heute") und
    // ist dort bereits behandelt worden.
    if (event.target !== this.zeile.nativeElement) {
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    // Ohne dies springt die Seite bei der Leertaste eine Bildschirmhöhe weiter,
    // während sich der Dialog öffnet.
    event.preventDefault();
    this.zeile.nativeElement.click();
  }
}

import {ChangeDetectionStrategy, Component, computed, input, output} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';

import {AppFailure, FEHLERKLASSE_WORTE} from '../../core/errors/app-failure';
import {AppIconErrorDirective} from '../app-icons';

/**
 * Die Oberfläche des **Ladens im Hintergrund** (ADR 0037): ein gescheitertes GET
 * ersetzt **den Inhalt, den es laden sollte**, statt drei Sekunden zu toasten
 * und eine leere Liste stehen zu lassen.
 *
 * Genau das war der Defekt aus PRD #438: „Es sind noch keine Stationen angelegt"
 * und „Stationen konnten nicht geladen werden" sahen identisch aus. Deshalb
 * trägt dieser Zustand das App-Icon des **kaputten** Zustands, während der leere
 * bei seinem eigenen Text und seinem eigenen Icon bleibt (#439) — auf jedem
 * Bildschirm auf den ersten Blick zu unterscheiden.
 *
 * Verallgemeinert aus dem #385-Idiom des Erfassungsformulars: **dasselbe Bauteil
 * auf allen sechs Bildschirmen**, damit der kaputte Zustand überall gleich
 * aussieht. Wo ein Bildschirm schon eine eigene Ausstiegs-Aktion hat (das
 * „Zur Liste" von `data-entry-form`), wird sie hineingereicht und steht daneben.
 *
 * **Kein Banner.** Das Banner (`app-failure-banner`) sitzt *über* einem
 * bedienbaren Formular und gehört der ausgelösten Schreibung; dieses Bauteil
 * steht *an der Stelle* des Inhalts, der nicht kam. Die beiden Oberflächen
 * bleiben getrennt, weil ihre Momente es sind.
 *
 * Die Worte kommen aus der **Fehlerklasse** — der Titel sagt, *was* nicht kam
 * (den kennt nur der Bildschirm), der Rest sagt, *was zu tun ist*. Aus ADR 0037s
 * Zeile „Laden im Hintergrund" trägt genau eine Klasse einen Knopf: *Erneut
 * versuchen* bekommt „Erneut laden". *Neu anmelden*, *Freigeben lassen* und
 * *App aktualisieren* sagen an Ort und Stelle, was sie brauchen — erneut zu
 * laden hülfe gegen keinen von ihnen. *Korrigieren* kommt hier gar nicht vor:
 * ein Laden hat kein Feld zu berichtigen.
 */
@Component({
  selector: 'app-load-failure',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, AppIconErrorDirective],
  templateUrl: './load-failure.html',
  styleUrls: ['./load-failure.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadFailureComponent {
  /** Der eingeordnete Fehlschlag — die Klasse bestimmt Worte und Knopf. */
  readonly failure = input.required<AppFailure>();

  /**
   * Was nicht geladen werden konnte („Stationen konnten nicht geladen werden.").
   * Das weiß nur der Bildschirm; ohne Angabe steht der Titel der Klasse da.
   */
  readonly titel = input<string | null>(null);

  /**
   * „Erneut laden": was das im Einzelnen heißt — welches GET erneut fliegt —
   * weiß nur der Bildschirm, also meldet dieses Bauteil den Druck nach oben,
   * statt ihn selbst auszuführen.
   */
  readonly reload = output<void>();

  protected readonly worte = computed(() => FEHLERKLASSE_WORTE[this.failure().klasse]);
  protected readonly titelZeile = computed(() => this.titel() ?? this.worte().titel);
  protected readonly abhilfe = computed(() => this.failure().remedy);
}

import {Directive, inject} from '@angular/core';
import {MatIcon, MatIconRegistry} from '@angular/material/icon';
import {DomSanitizer} from '@angular/platform-browser';

/**
 * Der Icon-Seam (#439, ADR 0037; eingelöst in #514 nach ADR 0044): „Der leere
 * und der kaputte Zustand bekommen verschiedene Vögel."
 *
 * Zwei benannte App-Icons — `app-icon-error` und `app-icon-empty` — an genau
 * dieser einen Stelle. Ein Template schreibt den Namen an sein `<mat-icon>`:
 *
 *     <mat-icon app-icon-error aria-hidden="true"></mat-icon>
 *     <mat-icon app-icon-empty aria-hidden="true"></mat-icon>
 *
 * ...und kennt die Zeichnung dahinter nicht. Dahinter stehen seit #514 die
 * gezeichneten Vögel des Künstlers (`docs/brand/SVG/`): der `!`-Vogel trägt
 * den kaputten Zustand, der `?`-Vogel den leeren. Der Tausch war eine Änderung
 * an dieser Datei — kein Template wurde angefasst, womit die Zusage aus ADR
 * 0037 zum ersten Mal eingelöst ist.
 *
 * **Der `?` trägt den leeren Zustand nur vorläufig mit.** B1 („keine Fänge",
 * #508) ist nicht gezeichnet; bis die Nachlieferung da ist, meint der `?` auf
 * `stationen`/`beringer`/`artennormen` *nicht gefunden*, wo *noch nicht
 * angelegt* gilt. Das ist die kleinere Sünde gegenüber einer Material-Ligatur
 * neben einem handgezeichneten Vogel im selben Slot derselben Ansicht (ADR
 * 0044) — und der Nachtausch ist wieder nur diese Datei.
 *
 * `scripts/check-icon-seam.mjs` hält das repo-weit dicht.
 *
 * Die Direktive setzt das Icon am `<mat-icon>`, statt es zu umhüllen: das
 * Element bleibt genau dort, wo es war, und alle bestehenden Regeln der
 * umgebenden Komponente (`.sync-error-banner mat-icon`, `inline="true"`, …)
 * greifen unverändert weiter.
 */

/**
 * Die Zeichnungen selbst — **eingebettet, nicht geladen** (ADR 0044).
 *
 * `addSvgIconLiteral` statt `addSvgIcon(url)`: die `assets`-Gruppe in
 * `ngsw-config.json` ist `lazy`, eine Datei landet also erst nach ihrer ersten
 * Anfrage im Zwischenspeicher. Der Fehler-Vogel rendert womöglich zum
 * allerersten Mal offline in einer Feldstation — genau in dem Moment, für den
 * die Fehleroberflächen aus ADR 0037 existieren. Wer ihn dann über HTTP holen
 * will, zeigt ein leeres Kästchen, wenn es am meisten zählt.
 *
 * Beide Quellen sind die Originale aus `docs/brand/SVG/`, unverändert bis auf
 * den XML-Vorspann, die Layer-Namen des Zeichenprogramms und die festen Maße
 * (die Registry setzt Höhe und Breite ohnehin auf 100 %). Kein `fill`: die
 * Vögel erben die Farbe der Meldung daneben, weil `.mat-icon` `fill:
 * currentColor` setzt und `fill` sich vererbt.
 */

/** Der `!`-Vogel — B3 aus `docs/artist-brief.md`, Quelle `docs/brand/SVG/birb_error.svg`. */
const VOGEL_KAPUTT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
  <path d="M196.09,98.96c-.17,3.58,2.59,6.63,6.17,6.8,3.58.17,6.63-2.59,6.8-6.17.17-3.58-2.59-6.63-6.17-6.8s-6.63,2.59-6.8,6.17Z"/>
  <path d="M232.17,58.83c-1.71,2.33-3.21,4.94-4.51,7.84,28.86,20.98,47.66,55,47.66,93.32,0,45.87-26.92,85.56-65.79,104.13,1.8-18.98,1.63-38.45-.5-57.97-.85-7.74-1.91-15.04-3.18-21.91l27.17-2.26c2.03-.17,3.69-1.68,4.05-3.68.37-2-.66-4-2.5-4.87l-28.39-13.49,25.67-28.16c1.34-1.47,1.56-3.65.53-5.36-1.03-1.7-3.06-2.53-4.98-2.03-1.06.28-23.55,6.17-36.9,13.1-2.09-3.78-4.32-7.22-6.71-10.32-14.14-18.36-30.45-20.87-41.63-19.72-29.54,3-49.6,33.17-51.12,76.86-.77,22.24-2.48,44.75-13.16,56.55-20.51-20.83-33.19-49.39-33.19-80.86,0-63.59,51.73-115.32,115.32-115.32,14.62,0,28.62,2.74,41.5,7.73l.35-9.47c-13.09-4.69-27.18-7.26-41.86-7.26-68.55,0-124.32,55.77-124.32,124.32,0,35.33,14.81,67.26,38.55,89.92.01.02.02.04.04.05.27.33.59.6.92.84,22.23,20.77,52.06,33.51,84.81,33.51,68.55,0,124.32-55.77,124.32-124.32,0-41.66-20.6-78.6-52.15-101.17ZM215.63,174.39l-11.61.97c-.57-2.51-1.17-4.95-1.8-7.34l13.41,6.37ZM214.3,137.67l-16,17.55c-1.2-3.39-2.47-6.62-3.83-9.66,5.49-2.89,13.09-5.68,19.82-7.89ZM84.43,247.03c12.81-14.02,14.77-38.41,15.6-62.41,1.35-38.93,18.24-65.71,43.03-68.22,29.62-2.99,50.38,30.07,57.02,90.73,2.25,20.59,2.23,41.1-.03,61.01-12.48,4.64-25.97,7.18-40.05,7.18-28.88,0-55.32-10.68-75.57-28.29Z"/>
  <path d="M209.75,84.75c.26.04.51.07.76.07,1.97,0,3.76-1.3,4.32-3.25,5.57-19.34,16.42-39.57,27-50.35,1.65-1.68,1.72-4.34.18-6.11-4.06-4.64-14.33-15.32-22.06-14.29-2.72.37-4.92,2.01-6.18,4.63-4.27,8.83-7.2,55.37-7.74,64.61-.13,2.29,1.47,4.31,3.73,4.7ZM221.69,19.82c2.13.58,6.65,4.07,10.81,8.27-5.39,6.24-10.71,14.47-15.35,23.54,1.71-18.54,3.47-28.79,4.54-31.8Z"/>
  <path d="M142.12,152.81c0,6.68,5.42,12.1,12.1,12.1s11.56-4.91,12.05-11.14c-6.75-2.52-15.34-5.76-21.69-8.26-1.54,2.03-2.47,4.55-2.47,7.3Z"/>
</svg>`;

/** Der `?`-Vogel — ungefragt geliefert, Quelle `docs/brand/SVG/birb_404.svg`. */
const VOGEL_LEER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
  <path d="M234.32,60.41l-7.24,5.85c29.19,20.94,48.24,55.16,48.24,93.74,0,45.87-26.92,85.56-65.79,104.13,1.8-18.98,1.63-38.45-.5-57.97-1.55-14.2-3.83-26.95-6.82-38.21.06-.06.13-.11.19-.18l29.61-36.16c1.23-1.51,1.36-3.64.31-5.28-1.05-1.64-3.04-2.42-4.92-1.93-1.06.28-23.55,6.17-36.9,13.1-2.09-3.78-4.32-7.22-6.71-10.32-14.14-18.36-30.44-20.87-41.63-19.72-29.54,3-49.61,33.17-51.12,76.86-.77,22.24-2.48,44.75-13.16,56.55-20.51-20.83-33.19-49.39-33.19-80.86,0-63.59,51.73-115.32,115.32-115.32,16.44,0,32.08,3.47,46.25,9.69l8.67-5.88c-16.57-8.19-35.21-12.81-54.92-12.81-68.55,0-124.32,55.77-124.32,124.32,0,35.33,14.81,67.26,38.55,89.92.01.02.02.04.04.05.27.33.59.6.92.84,22.23,20.77,52.06,33.51,84.81,33.51,68.55,0,124.32-55.77,124.32-124.32,0-40.71-19.67-76.9-49.99-99.59ZM215.8,137.18l-16.69,20.38c-1.42-4.26-2.97-8.27-4.63-12.01,5.91-3.11,14.24-6.1,21.32-8.37ZM84.43,247.03c12.81-14.02,14.77-38.41,15.6-62.41,1.35-38.93,18.24-65.71,43.03-68.22,29.62-2.98,50.38,30.07,57.02,90.73,2.25,20.59,2.23,41.1-.03,61.01-12.48,4.64-25.97,7.18-40.05,7.18-28.88,0-55.32-10.68-75.57-28.29Z"/>
  <path d="M208.87,30.87c5.95-4.92,12.31-6.53,17.44-4.44,3.53,1.44,5.86,4.49,6.25,8.16.6,5.66-3.34,11.82-10.8,16.9-1.58,1.08-3.1,2.1-4.55,3.09-13.62,9.21-21.13,14.29-22.31,21.24-.52,3.03.32,6.04,2.47,8.94,1.94,2.61,5.45,5.31,11.66,5.31,1.81,0,3.84-.23,6.13-.75,5.23-1.2,9.6-3.48,9.78-3.57,2.2-1.15,3.04-3.87,1.89-6.07-1.15-2.2-3.87-3.05-6.07-1.9-3.92,2.04-13.44,5.29-16.17,1.62-.95-1.28-.85-1.87-.82-2.06.54-3.16,8.85-8.79,18.48-15.29,1.46-.99,2.99-2.02,4.58-3.1,10.29-7.01,15.64-16.22,14.68-25.28-.74-7.02-5.15-12.84-11.8-15.55-8.3-3.39-17.99-1.26-26.58,5.83-1.92,1.58-2.19,4.42-.6,6.33,1.58,1.92,4.42,2.19,6.33.6Z"/>
  <path d="M204.88,98.92c-3.48-.87-7.01,1.24-7.88,4.72s1.24,7.01,4.72,7.88c3.48.87,7.01-1.24,7.88-4.72s-1.24-7.01-4.72-7.88Z"/>
  <circle cx="155.3" cy="153.89" r="11.02"/>
</svg>`;

/**
 * Die Hinterlegung der beiden Namen — die eine Stelle, die eine Zeichnung kennt.
 *
 * Bewusst ein Objektliteral aus String-Literalen und bewusst exportiert:
 * `scripts/check-icon-seam.mjs` **liest diese Tabelle aus dieser Datei**, statt
 * sie zu wiederholen. Sonst wäre „Einwechseln ist eine Datei" gelogen — nach
 * einem Tausch bewachte der Check weiter die alte Hinterlegung, würde grün und
 * bewachte nichts mehr. Wer hier tauscht, ändert genau diese zwei Zeilen und
 * die Zeichnung darüber; Check, Specs und Templates ziehen von allein nach.
 *
 * Die Tabelle führt seit #514 nur noch **Namen**; die Zeichnungen stehen als
 * eigene Konstanten darüber. Ein mehrzeiliges SVG-Literal in der Tabelle wäre
 * für Mensch und Wächter gleichermaßen unlesbar — der Wächter liest deshalb
 * beides: die Tabelle und die Zeichnungen.
 */
export const APP_ICON_BACKINGS = {
  'app-icon-error': 'birddoc-vogel-kaputt',
  'app-icon-empty': 'birddoc-vogel-leer',
} as const;

/** Welcher Name welche Zeichnung trägt. */
const APP_ICON_QUELLEN: Record<(typeof APP_ICON_BACKINGS)[keyof typeof APP_ICON_BACKINGS], string> =
  {
    'birddoc-vogel-kaputt': VOGEL_KAPUTT,
    'birddoc-vogel-leer': VOGEL_LEER,
  };

/**
 * Welche Registry die Vögel schon kennt.
 *
 * `MatIconRegistry` ist `root`-weit eine Instanz, in jeder Spec aber eine neue.
 * Gemerkt wird deshalb die Registry und nicht ein globales Flag: so hinterlegt
 * jede Wurzel ihre eigenen Vögel, und keine Spec und kein `app.config.ts` muss
 * dafür etwas tun — der Seam bleibt diese eine Datei.
 */
const hinterlegt = new WeakSet<MatIconRegistry>();

/** Hinterlegt beide Zeichnungen einmal je Registry. */
function hinterlege(): void {
  const registry = inject(MatIconRegistry);
  if (hinterlegt.has(registry)) return;
  hinterlegt.add(registry);

  const sanitizer = inject(DomSanitizer);
  for (const [name, quelle] of Object.entries(APP_ICON_QUELLEN)) {
    registry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(quelle));
  }
}

/**
 * Setzt die Hinterlegung an das `<mat-icon>`, an dem die Direktive hängt.
 *
 * `svgIcon` ist ein Setter, der sofort zeichnet — deshalb steht das hier im
 * Konstruktor und nicht in `ngOnInit`: das `<mat-icon>` bekommt so gar nicht
 * erst die Schriftart-Klasse einer Ligatur angehängt.
 */
function zeichne(name: string): void {
  hinterlege();
  inject(MatIcon).svgIcon = name;
}

/** Der kaputte Zustand. */
@Directive({
  selector: 'mat-icon[app-icon-error]',
})
export class AppIconErrorDirective {
  constructor() {
    zeichne(APP_ICON_BACKINGS['app-icon-error']);
  }
}

/** Der leere Zustand. */
@Directive({
  selector: 'mat-icon[app-icon-empty]',
})
export class AppIconEmptyDirective {
  constructor() {
    zeichne(APP_ICON_BACKINGS['app-icon-empty']);
  }
}

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';

import { AppIconEmptyDirective, AppIconErrorDirective } from './app-icons';

@Component({
  imports: [MatIconModule, AppIconErrorDirective, AppIconEmptyDirective],
  template: `
    <mat-icon app-icon-error aria-hidden="true"></mat-icon>
    <mat-icon app-icon-empty aria-hidden="true"></mat-icon>
  `,
})
class HostComponent {}

describe('Icon-Seam (app-icon-error / app-icon-empty)', () => {
  let fixture: ComponentFixture<HostComponent>;

  const iconAt = (selector: string) =>
    fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('gibt dem kaputten Zustand sein Icon, ohne dass das Template es benennt', () => {
    expect(iconAt('mat-icon[app-icon-error]')?.textContent?.trim()).toBeTruthy();
  });

  it('gibt dem leeren Zustand sein Icon, ohne dass das Template es benennt', () => {
    expect(iconAt('mat-icon[app-icon-empty]')?.textContent?.trim()).toBeTruthy();
  });

  // ADR 0037: „Der leere und der kaputte Zustand bekommen verschiedene Vögel." Bis
  // die Zeichnungen da sind, stehen zwei *verschiedene* Material-Icons dahinter.
  it('unterscheidet den leeren vom kaputten Zustand', () => {
    const error = iconAt('mat-icon[app-icon-error]')?.textContent?.trim();
    const empty = iconAt('mat-icon[app-icon-empty]')?.textContent?.trim();

    expect(error).not.toEqual(empty!);
  });

  // Der Seam ist die eine Stelle: das Template setzt keinen Text, die Direktive tut es.
  it('lässt das Icon auch dann stehen, wenn erneut geprüft wird', () => {
    fixture.detectChanges();

    expect(iconAt('mat-icon[app-icon-error]')?.textContent?.trim()).toBe('error_outline');
    expect(iconAt('mat-icon[app-icon-empty]')?.textContent?.trim()).toBe('inbox');
  });
});

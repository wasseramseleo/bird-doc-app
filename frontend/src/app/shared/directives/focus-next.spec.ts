import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { FocusNextDirective } from './focus-next';

@Component({
  imports: [FocusNextDirective],
  template: `
    <form>
      <input [appFocusNext]="'second'" formControlName="first" />
      <input formControlName="second" />
    </form>
  `,
})
class HostComponent {}

describe('FocusNextDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('moves focus to the named control when Enter is pressed', () => {
    const first = fixture.debugElement.query(By.css('[formControlName="first"]'))
      .nativeElement as HTMLInputElement;
    const second = fixture.debugElement.query(By.css('[formControlName="second"]'))
      .nativeElement as HTMLInputElement;

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(document.activeElement).toBe(second);
  });
});

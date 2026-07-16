import {Component, ViewChild} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {FormControl, ReactiveFormsModule} from '@angular/forms';
import {MatAutocompleteModule, MatAutocompleteTrigger} from '@angular/material/autocomplete';
import {MatInputModule} from '@angular/material/input';
import {provideNoopAnimations} from '@angular/platform-browser/animations';
import {By} from '@angular/platform-browser';

import {SelectOnTabDirective} from './select-on-tab';

interface Option {
  id: number;
  name: string;
}

@Component({
  imports: [ReactiveFormsModule, MatAutocompleteModule, MatInputModule, SelectOnTabDirective],
  template: `
    <input [formControl]="control" [matAutocomplete]="auto" selectOnTab>
    <mat-autocomplete #auto="matAutocomplete" [displayWith]="display" [autoActiveFirstOption]="true">
      @for (option of options; track option.id) {
        <mat-option [value]="option">{{ option.name }}</mat-option>
      }
      @if (showAction) {
        <mat-option [value]="null">➕ Neuer Eintrag</mat-option>
      }
    </mat-autocomplete>
  `,
})
class HostComponent {
  @ViewChild(MatAutocompleteTrigger) trigger!: MatAutocompleteTrigger;
  readonly control = new FormControl<Option | string | null>(null);
  options: Option[] = [
    {id: 1, name: 'Station Hohenau'},
    {id: 2, name: 'Station Marchegg'},
  ];
  showAction = false;
  display(option: Option | null): string {
    return option ? option.name : '';
  }
}

describe('SelectOnTabDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let input: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    input = fixture.debugElement.query(By.css('input')).nativeElement;
  });

  it('commits the highlighted option when Tab is pressed', () => {
    host.trigger.openPanel();
    fixture.detectChanges();

    // autoActiveFirstOption highlights the first option once the panel opens.
    expect(host.trigger.activeOption?.value).toEqual(host.options[0]);

    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
    fixture.detectChanges();

    expect(host.control.value).toEqual(host.options[0]);
  });

  it('does nothing when the panel is closed', () => {
    host.control.setValue('Hohe');
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
    fixture.detectChanges();

    expect(host.control.value).toBe('Hohe');
  });

  // Issue #374 (#4): an action option (e.g. "➕ Neuer Beringer") carries a null
  // value and must never be committed by Tab, even when autoActiveFirstOption
  // highlights it as the only remaining option — creating stays a deliberate click.
  it('does not commit an active option whose value is null', () => {
    host.options = [];
    host.showAction = true;
    host.control.setValue('Neu');
    fixture.detectChanges();

    host.trigger.openPanel();
    fixture.detectChanges();

    // The lone action option is highlighted but carries a null value.
    expect(host.trigger.activeOption?.value).toBeNull();

    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
    fixture.detectChanges();

    // The typed text is kept; the null-valued action option is not committed.
    expect(host.control.value).toBe('Neu');
  });
});

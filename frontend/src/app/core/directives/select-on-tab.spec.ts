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
    </mat-autocomplete>
  `,
})
class HostComponent {
  @ViewChild(MatAutocompleteTrigger) trigger!: MatAutocompleteTrigger;
  readonly control = new FormControl<Option | string | null>(null);
  readonly options: Option[] = [
    {id: 1, name: 'Station Hohenau'},
    {id: 2, name: 'Station Marchegg'},
  ];
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
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataEntryForm } from './data-entry-form';

describe('DataEntryForm', () => {
  let component: DataEntryForm;
  let fixture: ComponentFixture<DataEntryForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataEntryForm]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataEntryForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

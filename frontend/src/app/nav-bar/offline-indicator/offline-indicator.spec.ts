import {ComponentFixture, TestBed} from '@angular/core/testing';

import {OfflineIndicator} from './offline-indicator';
import {ConnectivityService} from '../../core/offline/connectivity';

describe('OfflineIndicator', () => {
  let fixture: ComponentFixture<OfflineIndicator>;
  let connectivity: ConnectivityService;

  beforeEach(() => {
    TestBed.configureTestingModule({imports: [OfflineIndicator]});
    fixture = TestBed.createComponent(OfflineIndicator);
    connectivity = TestBed.inject(ConnectivityService);
    fixture.detectChanges();
  });

  it('shows nothing while the app has connectivity', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent?.trim()).toBe('');
  });

  it('shows the "Offline – Einträge werden lokal gespeichert" indication once the app goes offline', () => {
    connectivity.markOffline();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Offline – Einträge werden lokal gespeichert');
  });

  it('hides again once connectivity returns', () => {
    connectivity.markOffline();
    fixture.detectChanges();

    connectivity.markOnline();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent?.trim()).toBe('');
  });
});

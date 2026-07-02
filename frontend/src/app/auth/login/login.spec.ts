import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { LoginComponent } from './login';
import { AuthService } from '../../service/auth.service';

function setup() {
  const routeStub = {
    snapshot: { queryParamMap: { get: () => null } },
  };
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
      { provide: ActivatedRoute, useValue: routeStub },
    ],
  });
  const fixture: ComponentFixture<LoginComponent> = TestBed.createComponent(LoginComponent);
  const component = fixture.componentInstance;
  const auth = TestBed.inject(AuthService);
  const router = TestBed.inject(Router);
  return { fixture, component, auth, router };
}

describe('LoginComponent', () => {
  it('labels the identifier field as E-Mail', () => {
    const { fixture } = setup();
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('mat-label') as HTMLElement;
    expect(label.textContent?.trim()).toBe('E-Mail');
  });

  it('submits the entered email through the unchanged login flow', () => {
    const { fixture, component, auth, router } = setup();
    const login = spyOn(auth, 'login').and.returnValue(
      of({
        username: 'birder@example.com',
        handle: null,
        isStaff: false,
        rolle: null,
        organization: null,
      }),
    );
    spyOn(router, 'navigateByUrl').and.stub();
    fixture.detectChanges();

    component.form.setValue({
      username: 'birder@example.com',
      password: 'hunter2-very-strong',
    });
    component.onSubmit();

    expect(login).toHaveBeenCalledWith('birder@example.com', 'hunter2-very-strong');
  });
});

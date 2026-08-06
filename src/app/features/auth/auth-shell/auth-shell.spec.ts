import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuthShell } from './auth-shell';
import { testProviders } from '../../../../testing/test-providers';

describe('AuthShell', () => {
  let component: AuthShell;
  let fixture: ComponentFixture<AuthShell>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthShell],
      providers: testProviders(),
    }).compileComponents();

    fixture = TestBed.createComponent(AuthShell);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResultsDashboard } from './results-dashboard';
import { testProviders } from '../../../testing/test-providers';

describe('ResultsDashboard', () => {
  let component: ResultsDashboard;
  let fixture: ComponentFixture<ResultsDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResultsDashboard],
      providers: testProviders(),
    }).compileComponents();

    fixture = TestBed.createComponent(ResultsDashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

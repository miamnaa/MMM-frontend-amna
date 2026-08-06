import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Scenarios } from './scenarios';
import { testProviders } from '../../../testing/test-providers';

describe('Scenarios', () => {
  let component: Scenarios;
  let fixture: ComponentFixture<Scenarios>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Scenarios],
      providers: testProviders(),
    }).compileComponents();

    fixture = TestBed.createComponent(Scenarios);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

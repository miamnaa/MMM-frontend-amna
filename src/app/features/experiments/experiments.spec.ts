import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Experiments } from './experiments';
import { testProviders } from '../../../testing/test-providers';

describe('Experiments', () => {
  let component: Experiments;
  let fixture: ComponentFixture<Experiments>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Experiments],
      providers: testProviders(),
    }).compileComponents();

    fixture = TestBed.createComponent(Experiments);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

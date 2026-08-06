import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Models } from './models';
import { testProviders } from '../../../testing/test-providers';

describe('Models', () => {
  let component: Models;
  let fixture: ComponentFixture<Models>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Models],
      providers: testProviders(),
    }).compileComponents();

    fixture = TestBed.createComponent(Models);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { TestBed } from '@angular/core/testing';

import { P2pService } from './p2p.service';

describe('P2pService', () => {
  let service: P2pService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(P2pService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

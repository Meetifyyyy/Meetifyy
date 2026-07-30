import { describe, beforeEach, it, expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { KeysService } from './keys.service';
import { PrismaService } from '../prisma/prisma.service';

describe('KeysService', () => {
  let service: KeysService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeysService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<KeysService>(KeysService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { describe, beforeEach, it, expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { KeysController } from './keys.controller';
import { KeysService } from './keys.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('KeysController', () => {
  let controller: KeysController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KeysController],
      providers: [
        { provide: KeysService, useValue: {} },
        { provide: SupabaseService, useValue: {} },
      ],
    }).compile();

    controller = module.get<KeysController>(KeysController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

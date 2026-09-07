import { describe, beforeEach, it, expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { legalConsentMockProvider } from '../common/legal/testing/legal-consent.mock';

describe('SearchController', () => {
  let controller: SearchController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        { provide: SearchService, useValue: {} },
        { provide: SupabaseService, useValue: {} },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: async () => null } },
        },
        // JwtGuard takes the consent gate as a constructor argument, so the
        // guard cannot be instantiated without it. Defaults to "nothing
        // requires acknowledgement", which is this suite's subject.
        legalConsentMockProvider(),
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

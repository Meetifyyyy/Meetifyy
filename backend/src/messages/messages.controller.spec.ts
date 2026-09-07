import { describe, beforeEach, it, expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { DomainEventService } from '../events/domain-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { studentYearPolicyMockProvider } from '../common/student-year/testing/student-year-policy.mock';
import { legalConsentMockProvider } from '../common/legal/testing/legal-consent.mock';

describe('MessagesController', () => {
  let controller: MessagesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        studentYearPolicyMockProvider(),
        { provide: MessagesService, useValue: {} },
        { provide: DomainEventService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
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

    controller = module.get<MessagesController>(MessagesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

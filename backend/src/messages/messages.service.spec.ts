import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';

describe('MessagesService', () => {
  let service: MessagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        {
          provide: PrismaService,
          useValue: {
            conversation: { findFirst: jest.fn(), findUnique: jest.fn() },
            conversationParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
            message: { create: jest.fn(), findFirst: jest.fn() },
            block: { findFirst: jest.fn() },
            $transaction: jest.fn(),
          },
        },
        {
          provide: PresenceService,
          useValue: { setOnline: jest.fn(), setOffline: jest.fn(), getPresence: jest.fn() },
        },
        {
          provide: DomainEventService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

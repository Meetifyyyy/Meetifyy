// The module graph pulls in sanitize-html (ESM, not transformed by this Jest
// config); this suite only inspects how the queue is registered.
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));

// Record what the module hands BullModule.registerQueue when it is evaluated.
jest.mock('@nestjs/bullmq', () => {
  const actual =
    jest.requireActual<typeof import('@nestjs/bullmq')>('@nestjs/bullmq');
  return {
    ...actual,
    BullModule: {
      ...actual.BullModule,
      registerQueue: jest.fn(actual.BullModule.registerQueue),
    },
  };
});

import { BullModule } from '@nestjs/bullmq';
import { EMAIL_QUEUE_DEFAULT_JOB_OPTIONS } from './email.module';

describe('EmailModule queue retention', () => {
  it('drops completed jobs and keeps failed ones for a day, capped', () => {
    expect(EMAIL_QUEUE_DEFAULT_JOB_OPTIONS).toEqual({
      removeOnComplete: true,
      removeOnFail: { age: 86_400, count: 1000 },
    });
  });

  it('registers the email queue with those defaults', () => {
    expect(BullModule.registerQueue).toHaveBeenCalledWith({
      name: 'email',
      defaultJobOptions: EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
    });
  });
});

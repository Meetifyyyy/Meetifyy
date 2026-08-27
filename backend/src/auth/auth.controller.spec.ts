jest.mock('../email/email.service');
jest.mock('../common/utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str) => str),
  sanitizePlainText: jest.fn((str) => str),
  htmlToPlainText: jest.fn((str) => str),
}));

import { ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController — Security / Email Notification Spoofing Prevention', () => {
  let controller: AuthController;
  let authService: any;
  let emailService: any;

  beforeEach(() => {
    authService = {};
    emailService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendNewLoginEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(authService, emailService);
  });

  it('allows welcome email to the authenticated caller’s own email', async () => {
    const user = { id: 'user-1', email: 'alice@example.com' };
    await controller.triggerWelcomeEmail(
      { email: 'alice@example.com', name: 'Alice' },
      user,
    );
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
      'alice@example.com',
      'Alice',
    );
  });

  it('rejects triggering welcome email for an arbitrary victim address', async () => {
    const user = { id: 'user-1', email: 'attacker@example.com' };
    await expect(
      controller.triggerWelcomeEmail(
        { email: 'victim@company.com', name: 'Victim' },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('rejects triggering login notification email for another recipient', async () => {
    const user = { id: 'user-1', email: 'attacker@example.com' };
    const req: any = { headers: {}, socket: {} };
    await expect(
      controller.triggerLoginEmail(
        { email: 'victim@company.com', name: 'Victim' },
        req,
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendNewLoginEmail).not.toHaveBeenCalled();
  });

  it('rejects triggering password-changed email for another recipient', async () => {
    const user = { id: 'user-1', email: 'attacker@example.com' };
    const req: any = { headers: {}, socket: {} };
    await expect(
      controller.triggerPasswordChangedEmail(
        { email: 'victim@company.com', name: 'Victim' },
        req,
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendPasswordChangedEmail).not.toHaveBeenCalled();
  });
});

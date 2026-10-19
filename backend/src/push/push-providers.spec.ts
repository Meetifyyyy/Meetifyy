import { classifyWebPushStatus } from './providers/web-push.provider';
import { classifyFcmError } from './providers/fcm.provider';

/**
 * Token lifecycle: a dead registration is deleted, a transient failure is
 * retried, and our own misconfiguration never deletes a user's devices.
 */
describe('push provider error mapping', () => {
  it.each([
    [404, 'gone'],
    [410, 'gone'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
    [undefined, 'retry'],
    [400, 'config'],
    [401, 'config'],
    [403, 'config'],
    [413, 'config'],
  ])('web push %s -> %s', (status, kind) => {
    expect(classifyWebPushStatus(status).kind).toBe(kind);
  });

  it.each([
    ['messaging/registration-token-not-registered', 'gone'],
    ['messaging/invalid-registration-token', 'gone'],
    ['messaging/mismatched-credential', 'gone'],
    ['messaging/server-unavailable', 'retry'],
    ['messaging/internal-error', 'retry'],
    ['messaging/message-rate-exceeded', 'retry'],
    ['messaging/third-party-auth-error', 'config'],
    ['messaging/authentication-error', 'config'],
    ['messaging/invalid-argument', 'config'],
  ])('FCM %s -> %s', (code, kind) => {
    expect(classifyFcmError({ code }).kind).toBe(kind);
  });

  it('treats an FCM failure with no code (network) as retryable', () => {
    expect(classifyFcmError(new Error('socket hang up')).kind).toBe('retry');
  });
});

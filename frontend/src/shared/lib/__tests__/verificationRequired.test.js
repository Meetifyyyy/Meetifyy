import { describe, expect, it, vi } from 'vitest';
import { handleVerificationRequired } from '../verificationRequired';
import {
  resolveForbiddenCode,
  VERIFICATION_REQUIRED_CODE,
} from '@core/api/verificationRequired';

describe('handleVerificationRequired', () => {
  it('opens the verification prompt for VERIFICATION_REQUIRED', () => {
    const open = vi.fn();
    expect(handleVerificationRequired(VERIFICATION_REQUIRED_CODE, open)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatch(/verify your account/i);
  });

  it.each([undefined, 'COLLEGE_RESTRICTED', 'ACCOUNT_BANNED'])(
    'ignores %s',
    (code) => {
      const open = vi.fn();
      expect(handleVerificationRequired(code, open)).toBe(false);
      expect(open).not.toHaveBeenCalled();
    },
  );
});

describe('resolveForbiddenCode', () => {
  const legacy = 'Account verification is required to perform this action.';

  it('keeps a code the server sent', () => {
    expect(resolveForbiddenCode(403, 'PRIVATE', legacy)).toBe('PRIVATE');
  });

  it('infers the code from the old plain-text 403', () => {
    expect(resolveForbiddenCode(403, undefined, legacy)).toBe(VERIFICATION_REQUIRED_CODE);
  });

  it('does not infer it for other statuses or messages', () => {
    expect(resolveForbiddenCode(401, undefined, legacy)).toBeUndefined();
    expect(resolveForbiddenCode(403, undefined, 'Forbidden')).toBeUndefined();
  });
});

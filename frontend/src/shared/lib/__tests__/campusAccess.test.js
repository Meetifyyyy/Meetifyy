import { describe, it, expect } from 'vitest';
import {
  applyAffiliationToUser,
  describeCampusOtpError,
  hasAffiliationField,
  isAffiliationActive,
  isCampusAffiliationError,
  legacyCampusAccess,
} from '../campusAccess';

const AFF = { collegeId: 'c2', collegeName: 'New College', logoUrl: 'logo.png', email: 'a***@new.edu', active: true };

describe('campus access', () => {
  it('tells "the API never sent it" apart from "sent as none"', () => {
    expect(hasAffiliationField({ id: 'u' })).toBe(false);
    expect(hasAffiliationField({ id: 'u', campusAffiliation: null })).toBe(true);
  });

  it('opens Campus on an active affiliation only, never on the selfie status', () => {
    expect(isAffiliationActive(AFF)).toBe(true);
    expect(isAffiliationActive({ ...AFF, active: false })).toBe(false);
    expect(isAffiliationActive(null)).toBe(false);
  });

  it('keeps the legacy rule for an API that predates affiliations', () => {
    expect(legacyCampusAccess({ verificationStatus: 'VERIFIED', collegeId: 'c1' })).toBe(true);
    expect(legacyCampusAccess({ verificationStatus: 'VERIFIED', collegeId: null })).toBe(false);
    expect(legacyCampusAccess({ verificationStatus: 'PENDING', collegeId: 'c1' })).toBe(false);
  });

  it('recognises the server refusing a campus route', () => {
    expect(isCampusAffiliationError({ status: 403, code: 'campus_affiliation_required' })).toBe(true);
    expect(isCampusAffiliationError({ status: 403, code: 'COLLEGE_RESTRICTED' })).toBe(false);
  });

  it('patches the user and its college mirror when an affiliation arrives', () => {
    const user = { id: 'u', collegeId: 'c1', college: { id: 'c1', name: 'Old College', city: 'X' } };
    const next = applyAffiliationToUser(user, AFF);
    expect(next.campusAffiliation).toBe(AFF);
    expect(next.collegeId).toBe('c2');
    expect(next.college).toEqual({ id: 'c2', name: 'New College', city: 'X', logoUrl: 'logo.png' });
    expect(next.collegeName).toBe('New College');
  });

  it('clears the mirror when the affiliation is removed', () => {
    const next = applyAffiliationToUser({ id: 'u', collegeId: 'c1', college: { name: 'Old' }, campusAffiliation: AFF }, null);
    expect(next.campusAffiliation).toBeNull();
    expect(next.collegeId).toBeNull();
    expect(next.college).toBeNull();
  });

  it('maps every contract error code to its own sentence', () => {
    const codes = ['invalid_college', 'domain_mismatch', 'college_email_unavailable', 'already_affiliated', 'invalid_code', 'expired_code', 'too_many_attempts'];
    const messages = codes.map((code) => describeCampusOtpError({ status: 400, code }));
    expect(new Set(messages).size).toBe(codes.length);
    // Never identifies who holds an address.
    expect(describeCampusOtpError({ status: 409, code: 'college_email_unavailable' })).not.toMatch(/@/);
  });
});

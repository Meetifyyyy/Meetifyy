import { describe, it, expect } from 'vitest';
import { RESUME_KEY, RESUME_TTL_MS, clearSignupResume, saveSignupResume, takeSignupResume } from '../signupResume';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const draft = { step: 4, data: { firstName: 'Asha', email: 'a@x.in', password: 'hunter2hunter2', confirmPassword: 'x' }, pendingEmail: '' };

describe('signup resume record', () => {
  it('never stores the password', () => {
    const s = memory();
    saveSignupResume(draft, { store: s });
    expect(s._m.get(RESUME_KEY)).not.toContain('hunter2');
    expect(s._m.get(RESUME_KEY)).not.toContain('password');
  });
  it('restores step and fields once, then removes itself', () => {
    const s = memory();
    saveSignupResume(draft, { store: s, now: 1000 });
    expect(takeSignupResume({ store: s, now: 2000 })).toEqual({ step: 4, data: { firstName: 'Asha', email: 'a@x.in' }, pendingEmail: '' });
    expect(takeSignupResume({ store: s, now: 2000 })).toBeNull();
  });
  it('expires after the TTL', () => {
    const s = memory();
    saveSignupResume(draft, { store: s, now: 0 });
    expect(takeSignupResume({ store: s, now: RESUME_TTL_MS + 1 })).toBeNull();
    expect(s._m.size).toBe(0);
  });
  it('rejects garbage and out-of-range steps', () => {
    const s = memory();
    s.setItem(RESUME_KEY, '{nope');
    expect(takeSignupResume({ store: s })).toBeNull();
    saveSignupResume({ ...draft, step: 6 }, { store: s });
    expect(takeSignupResume({ store: s })).toBeNull();
  });
  it('clear removes it', () => {
    const s = memory();
    saveSignupResume(draft, { store: s });
    clearSignupResume({ store: s });
    expect(s._m.size).toBe(0);
  });
});

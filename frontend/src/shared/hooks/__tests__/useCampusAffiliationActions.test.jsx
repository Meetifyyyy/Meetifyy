/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ sendOtp: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({ campusAffiliationApi: api }));
vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'me' }, updateCurrentUser: vi.fn(), refreshCurrentUser: vi.fn() }),
}));

import { CAMPUS_AFFILIATION_QUERY_KEY } from '@shared/lib/campusAccess';
import { useCampusAffiliationActions } from '../useCampusAffiliationActions';

afterEach(() => {
  cleanup();
  api.sendOtp.mockReset();
});

const setup = () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { invalidate, ...renderHook(() => useCampusAffiliationActions(), { wrapper }) };
};

it('re-reads the campus status when a code request is refused for an owner, and rethrows', async () => {
  const refusal = Object.assign(new Error('Transfer ownership first.'), { status: 409, code: 'CAMPUS_COMMUNITY_OWNER' });
  api.sendOtp.mockRejectedValueOnce(refusal);
  const { result, invalidate } = setup();

  await act(async () => {
    await expect(result.current.sendCode({ collegeId: 'c', email: 'a@b.edu' })).rejects.toBe(refusal);
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: CAMPUS_AFFILIATION_QUERY_KEY });
});

it('leaves the status alone for any other refusal', async () => {
  api.sendOtp.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 400, code: 'invalid_college' }));
  const { result, invalidate } = setup();

  await act(async () => {
    await result.current.sendCode({ collegeId: 'c', email: 'a@b.edu' }).catch(() => {});
  });
  expect(invalidate).not.toHaveBeenCalled();
});

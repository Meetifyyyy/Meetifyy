/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const picker = vi.hoisted(() => ({ calls: [], result: { conversations: [], isLoading: false, isSearching: false } }));
vi.mock('@shared/hooks/useRecipientConversations', () => ({
  useRecipientConversations: (enabled, search) => {
    picker.calls.push({ enabled, search });
    return picker.result;
  },
}));

import { useForwardRecipients } from '../useForwardRecipients';

beforeEach(() => {
  picker.calls = [];
  picker.result = { conversations: [{ id: 'a' }], isLoading: false, isSearching: false };
});

describe('useForwardRecipients', () => {
  it('sends what is typed to the server search, not just to a filter over the first page', () => {
    const { result } = renderHook(() => useForwardRecipients(true));
    expect(picker.calls.at(-1)).toEqual({ enabled: true, search: '' });

    act(() => result.current.onSearchChange('zed'));
    expect(picker.calls.at(-1)).toEqual({ enabled: true, search: 'zed' });
  });

  it('fetches nothing while the sheet is closed', () => {
    renderHook(() => useForwardRecipients(false));
    expect(picker.calls.at(-1).enabled).toBe(false);
  });

  it('counts a search still in flight as loading, so an empty list is not announced as "no matches" early', () => {
    picker.result = { conversations: [], isLoading: false, isSearching: true };
    const { result } = renderHook(() => useForwardRecipients(true));
    expect(result.current.isLoading).toBe(true);
  });

  it('passes the eligible conversations straight through', () => {
    const { result } = renderHook(() => useForwardRecipients(true));
    expect(result.current.conversations).toEqual([{ id: 'a' }]);
    expect(result.current.isLoading).toBe(false);
  });
});

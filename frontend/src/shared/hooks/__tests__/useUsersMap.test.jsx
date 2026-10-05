/** @vitest-environment jsdom */
/**
 * The users map keeps its identity while the users in it are unchanged.
 *
 * Every RichText and MessageBubble reads it through context, so a new object
 * re-renders all of them. The conversation list it is built from changes on
 * every message (preview, unread count, order) without any user changing.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let conversations = [];
let setConversations;

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' }, isLoggedIn: false }) }));
vi.mock('../useProfile', () => ({ useCampusUsers: () => ({ campusUsers: [] }) }));
vi.mock('../useMessages', async () => {
  const { useState } = await import('react');
  return {
    useConversations: () => {
      const [list, set] = useState(conversations);
      setConversations = set;
      return { conversations: list };
    },
  };
});
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../../api/apiClient', () => ({ usersApi: { getAll: vi.fn() } }));

const { UsersMapProvider, useUsersMap } = await import('../useUsersMap');
const wrapper = ({ children }) => <UsersMapProvider>{children}</UsersMapProvider>;

describe('UsersMapProvider', () => {
  it('hands out the same map when only conversation metadata changes', () => {
    const ada = { id: 'u1', username: 'ada' };
    conversations = [{ id: 'c1', targetUser: ada, lastMessage: 'hi', unread: 0 }];
    const { result } = renderHook(() => useUsersMap(), { wrapper });
    const first = result.current;
    expect(first.u1).toBe(ada);

    // A new message: new conversation object, same user object.
    act(() => setConversations([{ id: 'c1', targetUser: ada, lastMessage: 'new', unread: 1 }]));
    expect(result.current).toBe(first);

    // Group member details are rebuilt each time, but equal field-for-field.
    act(() => setConversations([{ id: 'c1', targetUser: ada, memberDetails: [{ userId: 'u2', username: 'bo' }] }]));
    const withBo = result.current;
    act(() => setConversations([{ id: 'c1', targetUser: ada, memberDetails: [{ userId: 'u2', username: 'bo' }], unread: 3 }]));
    expect(result.current).toBe(withBo);
  });

  it('replaces the map when a user in it changes', () => {
    conversations = [{ id: 'c1', targetUser: { id: 'u1', username: 'ada', isOnline: false } }];
    const { result } = renderHook(() => useUsersMap(), { wrapper });
    const first = result.current;
    act(() => setConversations([{ id: 'c1', targetUser: { id: 'u1', username: 'ada', isOnline: true } }]));
    expect(result.current).not.toBe(first);
    expect(result.current.u1.isOnline).toBe(true);
  });
});

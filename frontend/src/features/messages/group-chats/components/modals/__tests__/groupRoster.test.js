import { describe, it, expect } from 'vitest';
import { pickGroupRoster } from '../GroupSettingsModal';

describe('pickGroupRoster', () => {
  it('uses memberDetails when the group details endpoint hydrates it', () => {
    // the real shape: /group-chats/:id/details fills memberDetails, members is []
    const conv = {
      members: [],
      memberDetails: [{ userId: 'a' }, { userId: 'b' }],
      memberCount: 2,
    };
    expect(pickGroupRoster(conv)).toHaveLength(2);
  });

  it('still uses members when that is the populated one', () => {
    const conv = { members: [{ id: 'a' }], memberDetails: [] };
    expect(pickGroupRoster(conv)).toEqual([{ id: 'a' }]);
  });

  it('falls back to participants for DM-shaped conversations', () => {
    const conv = { participants: [{ id: 'x' }, { id: 'y' }] };
    expect(pickGroupRoster(conv)).toHaveLength(2);
  });

  it('prefers memberDetails over a populated members array', () => {
    const conv = { members: [{ id: 'stale' }], memberDetails: [{ userId: 'a' }, { userId: 'b' }] };
    expect(pickGroupRoster(conv)).toHaveLength(2);
  });

  it('returns an empty array rather than throwing on missing input', () => {
    expect(pickGroupRoster(undefined)).toEqual([]);
    expect(pickGroupRoster({})).toEqual([]);
    expect(pickGroupRoster({ members: [], memberDetails: [] })).toEqual([]);
  });
});

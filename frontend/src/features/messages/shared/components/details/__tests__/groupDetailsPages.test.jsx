/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

/**
 * The group's settings, join requests and ownership pages, and the live
 * updates that keep them current.
 */
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@shared/components/modals/ConfirmModal', () => ({
  default: ({ visible, title, desc, onConfirm }) =>
    visible ? (
      <div role="dialog" aria-label={title}>
        <p>{desc}</p>
        <button type="button" onClick={onConfirm}>Transfer</button>
      </div>
    ) : null,
}));

const { default: GroupSettingsPage } = await import('../GroupSettingsPage');
const { default: GroupJoinRequestsPage } = await import('../GroupJoinRequestsPage');
const { default: GroupChangeOwnerPage } = await import('../GroupChangeOwnerPage');
const { normalizeWhoCanJoin, normalizeEditPermission } = await import('../../../utils/groupSettings');
const { applyOwnConversationPrefs, refreshJoinRequests } = await import('../../../utils/conversationLiveState');

afterEach(cleanup);

const settings = (props = {}) =>
  render(
    <GroupSettingsPage
      isOwner={false}
      isAdmin
      isMember
      isClosed={false}
      canEditGroupInfo
      whoCanJoin="ANYONE"
      editPermission="ADMIN"
      isMuted={false}
      onToggleMute={vi.fn()}
      onChangeWhoCanJoin={vi.fn(() => Promise.resolve(true))}
      onChangeEditPermission={vi.fn(() => Promise.resolve(true))}
      onBack={vi.fn()}
      onGoToEdit={vi.fn()}
      onGoToChangeOwner={vi.fn()}
      {...props}
    />,
  );

describe('group settings', () => {
  it('offers only settings that do something', () => {
    settings();
    for (const gone of ['Group updates', 'Visibility', 'Allow sharing', 'Leave group', 'End group']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.getByRole('switch', { name: 'Mute alerts' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Who can join' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Who can edit group info' })).toBeTruthy();
  });

  it('every option has its own hint, so switching never adds or removes a line', () => {
    const { rerender } = settings();
    const hintFor = () => screen.getByRole('radiogroup', { name: 'Who can join' }).parentElement.querySelector('[class*="choiceHint"]');
    expect(hintFor().textContent).toMatch(/straight away/);
    rerender(
      <GroupSettingsPage isAdmin isMember canEditGroupInfo whoCanJoin="APPROVAL" editPermission="ADMIN"
        onToggleMute={vi.fn()} onChangeWhoCanJoin={vi.fn()} onChangeEditPermission={vi.fn()}
        onBack={vi.fn()} onGoToEdit={vi.fn()} onGoToChangeOwner={vi.fn()} />,
    );
    expect(hintFor().textContent).toMatch(/review each request/);
  });

  it('a change is sent once, and the page says when it is saved', async () => {
    const onChangeWhoCanJoin = vi.fn(() => Promise.resolve(true));
    settings({ onChangeWhoCanJoin });
    fireEvent.click(screen.getByRole('radio', { name: 'Approval required' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Approval required' }));
    expect(onChangeWhoCanJoin).toHaveBeenCalledTimes(1);
    expect(onChangeWhoCanJoin).toHaveBeenCalledWith('APPROVAL');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });

  it('says so when the server refuses', async () => {
    settings({ onChangeEditPermission: vi.fn(() => Promise.resolve(false)) });
    fireEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not saved'));
  });

  it('a member sees the values, not the controls, and why', () => {
    settings({ isAdmin: false, canEditGroupInfo: false, whoCanJoin: 'APPROVAL' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('Approval required')).toBeTruthy();
    expect(screen.getByText('Only admins can change these.')).toBeTruthy();
    expect(screen.queryByText('Group info')).toBeNull();
    expect(screen.queryByText('Transfer ownership')).toBeNull();
  });
});

describe('join requests', () => {
  const requests = [
    { id: 'r1', userId: 'u1', username: 'ana', displayName: 'Ana', avatar: null, createdAt: new Date().toISOString() },
  ];

  it('names each requester from the request, and labels the buttons for them', () => {
    render(<GroupJoinRequestsPage pendingRequests={requests} onAccept={vi.fn()} onDecline={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept Ana' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline Ana' })).toBeTruthy();
  });

  it('a row is locked while its answer is out: one call, however many taps', async () => {
    let finish;
    const onAccept = vi.fn(() => new Promise((r) => { finish = r; }));
    render(<GroupJoinRequestsPage pendingRequests={requests} onAccept={onAccept} onDecline={vi.fn()} onBack={vi.fn()} />);
    const accept = screen.getByRole('button', { name: 'Accept Ana' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    fireEvent.click(screen.getByRole('button', { name: 'Decline Ana' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(accept.disabled).toBe(true);
    finish(true);
    await waitFor(() => expect(accept.disabled).toBe(false));
  });
});

describe('transfer ownership', () => {
  it('lists every other member, from the group\'s own list', () => {
    render(
      <GroupChangeOwnerPage
        members={[
          { userId: 'me', displayName: 'Me', username: 'me' },
          { userId: 'u1', displayName: 'Ana', username: 'ana' },
          { userId: 'u2', displayName: 'Deleted account', isDeleted: true, profileAvailable: false },
        ]}
        ownerId="me"
        onBack={vi.fn()}
        onChoose={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: 'Make owner' });
    expect(buttons).toHaveLength(2);
    expect(buttons[1].disabled).toBe(true);
    expect(screen.queryByText('Me')).toBeNull();
  });

  it('with no one else in the group, explains why and offers to invite', () => {
    const onInvite = vi.fn();
    render(<GroupChangeOwnerPage members={[{ userId: 'me', displayName: 'Me' }]} ownerId="me" onBack={vi.fn()} onChoose={vi.fn()} onInvite={onInvite} />);
    expect(screen.getByRole('heading', { name: 'No one to transfer to yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    expect(onInvite).toHaveBeenCalled();
  });
});

describe('setting values from older groups', () => {
  it.each([
    ['APPROVAL', 'APPROVAL'], ['Request required', 'APPROVAL'], ['approval-required', 'APPROVAL'],
    ['ANYONE', 'ANYONE'], ['Anyone', 'ANYONE'], [null, 'ANYONE'],
  ])('who can join %s reads as %s', (raw, code) => expect(normalizeWhoCanJoin(raw)).toBe(code));

  it.each([['EVERYONE', 'EVERYONE'], ['Everyone', 'EVERYONE'], ['ALL_MEMBERS', 'EVERYONE'], ['ADMIN', 'ADMIN'], [undefined, 'ADMIN']])(
    'who can edit %s reads as %s',
    (raw, code) => expect(normalizeEditPermission(raw)).toBe(code),
  );
});

describe('live updates', () => {
  it('a mute or pin from another device lands on the matching row only', () => {
    const qc = new QueryClient();
    qc.setQueryData(['conversations'], [
      { id: 'pub-1', internalId: 'int-1', muted: false },
      { id: 'pub-2', internalId: 'int-2', muted: false },
    ]);
    applyOwnConversationPrefs(qc, { conversationId: 'int-1', internalId: 'int-1', muted: true });
    applyOwnConversationPrefs(qc, { conversationId: 'int-2', pinned: true, pinnedAt: 'T' });
    const [a, b] = qc.getQueryData(['conversations']);
    expect(a).toMatchObject({ muted: true, isMuted: true });
    expect(b).toMatchObject({ muted: false, pinned: true, isPinned: true, pinnedAt: 'T' });
  });

  it('a change to a group\'s requests refetches that group\'s details only', () => {
    const qc = new QueryClient();
    qc.setQueryData(['groupDetails', 'pub-1'], { id: 'pub-1', internalId: 'int-1' });
    qc.setQueryData(['groupDetails', 'pub-2'], { id: 'pub-2', internalId: 'int-2' });
    refreshJoinRequests(qc, { internalId: 'int-1' });
    expect(qc.getQueryState(['groupDetails', 'pub-1']).isInvalidated).toBe(true);
    expect(qc.getQueryState(['groupDetails', 'pub-2']).isInvalidated).toBe(false);
  });
});

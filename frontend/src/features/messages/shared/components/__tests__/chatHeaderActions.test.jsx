/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@shared/hooks/usePresenceVisibility', () => ({ useCanSeeOthersPresence: () => true }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('@shared/components/skeletons/Skeleton', () => ({ default: () => <span /> }));

import DMChatHeader from '../../../direct-messages/components/chat/DMChatHeader';
import GroupChatHeader from '../../../group-chats/components/chat/GroupChatHeader';
import MuteAlertsModal from '../modals/MuteAlertsModal';

afterEach(cleanup);

const open = () => fireEvent.click(screen.getByTitle('More Options'));
const itemNames = () => screen.getAllByRole('menuitem').map((el) => el.textContent.trim());

const REMOVED = [/pin/i, /contact info/i, /group info/i, /mute/i, /block/i];

describe('chat header menu', () => {
  it('a DM header offers only Find in chat and Clear chat', () => {
    render(
      <DMChatHeader
        conversation={{ id: 'c1', name: 'Asha', type: 'DIRECT', targetUser: { id: 'u2' }, muted: false, pinned: false }}
        onBack={vi.fn()}
        onClearChat={vi.fn()}
        onToggleSearch={vi.fn()}
        onOpenDetails={vi.fn()}
      />,
    );
    open();

    expect(itemNames()).toEqual(['Find in chat', 'Clear chat']);
    for (const removed of REMOVED) {
      expect(itemNames().some((name) => removed.test(name))).toBe(false);
    }
  });

  it('a group header drops the same actions and keeps its group-only ones', () => {
    render(
      <GroupChatHeader
        conversation={{ id: 'g1', name: 'Study', type: 'GROUP', isMember: true, ownerId: 'other', members: ['me'] }}
        onBack={vi.fn()}
        onLeaveGroup={vi.fn()}
        onClearChat={vi.fn()}
        onToggleSearch={vi.fn()}
        onOpenDetails={vi.fn()}
      />,
    );
    open();

    const names = itemNames();
    for (const removed of REMOVED) expect(names.some((name) => removed.test(name))).toBe(false);
    expect(names).toEqual(expect.arrayContaining(['Find in chat', 'Clear chat', 'Leave group']));
  });

  it('tapping the header itself still opens the details', () => {
    const onOpenDetails = vi.fn();
    render(
      <DMChatHeader
        conversation={{ id: 'c1', name: 'Asha', type: 'DIRECT', targetUser: { id: 'u2' } }}
        onBack={vi.fn()}
        onOpenDetails={onOpenDetails}
      />,
    );
    fireEvent.click(screen.getByText('Asha'));
    expect(onOpenDetails).toHaveBeenCalled();
  });
});

describe('Mute alerts sheet', () => {
  it('is titled, explains what muting means, and offers Cancel and Mute', () => {
    render(<MuteAlertsModal onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Mute alerts')).toBeTruthy();
    expect(screen.getByText(/won.t get notifications from this chat/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mute' })).toBeTruthy();
  });

  it('confirms and cancels through the right callbacks', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(<MuteAlertsModal onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    vi.runAllTimers(); // the sheet finishes its close animation first
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    unmount();

    render(<MuteAlertsModal onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    vi.runAllTimers();
    expect(onCancel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

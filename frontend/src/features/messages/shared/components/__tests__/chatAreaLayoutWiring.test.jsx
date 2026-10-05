/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ details: null, list: null, forward: null, openViewer: null, send: null }));

vi.mock('@shared/context/MediaViewerContext', () => ({
  useMediaViewerActions: () => ({ openViewer: h.openViewer }),
}));
vi.mock('@shared/hooks/useMessageActions', () => ({ useMessageActions: () => ({ sendDirectMessage: h.send }) }));
vi.mock('@shared/hooks/useRecipientConversations', () => ({
  useRecipientConversations: () => ({ conversations: [], isLoading: false }),
}));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('../ChatMessageList', () => ({ default: (props) => { h.list = props; return <div data-testid="list" />; } }));
vi.mock('../ChatInputArea', () => ({ default: () => <div /> }));
vi.mock('../MessageContextMenu', () => ({ default: () => null }));
vi.mock('../details/ChatDetailsPanel', () => ({ default: (props) => { h.details = props; return <div data-testid="details" />; } }));
vi.mock('@shared/components/modals/ConfirmModal', () => ({ default: () => null }));
vi.mock('@shared/components/ui/NotFoundState', () => ({ default: () => null }));
vi.mock('../modals/ForwardMessageModal', () => ({ default: (props) => { h.forward = props; return <div data-testid="forward" />; } }));

const { default: ChatAreaLayout } = await import('../ChatAreaLayout');

const base = {
  conversation: { id: 'c1', messages: [] },
  currentUser: { id: 'me' },
  users: {},
  setShowDetails: () => {},
};

beforeEach(() => {
  h.details = null; h.list = null; h.forward = null;
  h.openViewer = vi.fn();
  h.send = vi.fn().mockResolvedValue({});
});
afterEach(() => cleanup());

describe('ChatAreaLayout wiring', () => {
  it('does not couple the details panel to the chat\'s history paging - the gallery has its own server-side paging', () => {
    render(<ChatAreaLayout {...base} showDetails hasMore isLoadingMore={false} onLoadMore={vi.fn()} />);
    expect(h.details.hasMore).toBeUndefined();
    expect(h.details.isLoadingMore).toBeUndefined();
    expect(h.details.onLoadMore).toBeUndefined();
  });

  it('hands the details panel Block and Clear chat, which used to live only in the header menu', () => {
    const onBlockUser = vi.fn();
    const onClearChat = vi.fn();
    render(<ChatAreaLayout {...base} showDetails conversation={{ id: 'c1', name: 'Asha' }} onBlockUser={onBlockUser} onClearChat={onClearChat} />);

    expect(h.details.onBlockUser).toBe(onBlockUser);
    h.details.onClearChat();
    expect(onClearChat).toHaveBeenCalledWith('c1');
  });

  it('opens the viewer with the bubble\'s report target and thumbnail intact', () => {
    render(<ChatAreaLayout {...base} />);
    const report = { targetType: 'MESSAGE', targetId: 'm1' };
    h.list.onOpenMediaModal('/api/media/chat/a.png', 'image', { report, thumb: '/api/media/chat/a_thumb.webp' });
    expect(h.openViewer).toHaveBeenCalledWith(
      [{ url: '/api/media/chat/a.png', type: 'image', thumb: '/api/media/chat/a_thumb.webp', report }],
      0,
    );
  });

  it('still opens a bare url with no extra', () => {
    render(<ChatAreaLayout {...base} />);
    h.list.onOpenMediaModal('/api/media/chat/a.png');
    expect(h.openViewer).toHaveBeenCalledWith([{ url: '/api/media/chat/a.png', type: 'image' }], 0);
  });

  it('forwards under the modal\'s operation id so a retry is recognised by the server', async () => {
    h.send.mockImplementation(async (id) => { if (id === 'b') throw new Error('down'); });
    render(
      <ChatAreaLayout
        {...base}
        forwardingMsg={{ text: 'hi', mediaUrl: '/api/media/chat/a.png', mediaType: 'image' }}
        setForwardingMsg={() => {}}
      />,
    );
    await waitFor(() => expect(h.forward).not.toBeNull());
    const error = await h.forward.onConfirmForward(['a', 'b'], { operationId: 'op' }).catch((e) => e);
    expect(error.name).toBe('ForwardPartialError');
    expect(error.failedIds).toEqual(['b']);
    expect(h.send.mock.calls[0][8]).toEqual({ tempId: 'fwd_op_a' });
    expect(h.send.mock.calls[1][8]).toEqual({ tempId: 'fwd_op_b' });
    expect(h.send.mock.calls[0][1]).toEqual({ text: 'hi', mediaUrl: '/api/media/chat/a.png', mediaType: 'image' });
  });
});

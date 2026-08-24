import { describe, it, expect } from 'vitest';
import { isInstantChat, isInstantChatNotification } from '../instantChatRouting';
import { messagesApi } from '../../api/apiClient';

describe('instant chat routing', () => {
  it('recognises a server-stamped instant message', () => {
    expect(isInstantChat({ chatType: 'instant' })).toBe(true);
    expect(isInstantChat({ isInstantMatch: true })).toBe(true);
  });

  it('routes anything unmarked to normal Messages', () => {
    // The conservative default: a payload from an older build, or from a path
    // that does not stamp the field, must not open the Instant Match overlay
    // on top of an unrelated conversation.
    expect(isInstantChat({ chatType: 'normal' })).toBe(false);
    expect(isInstantChat({ conversationId: 'c1' })).toBe(false);
    expect(isInstantChat(null)).toBe(false);
    expect(isInstantChat(undefined)).toBe(false);
  });

  it('reads a notification through its metadata', () => {
    expect(isInstantChatNotification({ type: 'MESSAGE', metadata: { chatType: 'instant' } })).toBe(true);
    expect(isInstantChatNotification({ type: 'MESSAGE', metadata: { chatType: 'normal', conversationId: 'c1' } })).toBe(false);
    expect(isInstantChatNotification(null)).toBe(false);
  });
});

describe('messagesApi', () => {
  it('exposes sendMessage, the name useChatManager calls generically', () => {
    // useChatManager picks dmApi / groupApi / messagesApi by chat type and
    // then calls `.sendMessage(...)`. messagesApi only had
    // `sendDirectMessage`, so the REST send path threw for every chat running
    // on it — which is exactly and only the Instant Match chat.
    expect(typeof messagesApi.sendMessage).toBe('function');
    expect(typeof messagesApi.getHistory).toBe('function');
  });
});

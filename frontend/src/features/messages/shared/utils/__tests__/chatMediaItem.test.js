import { describe, expect, it } from 'vitest';
import { chatMediaItem } from '../chatMediaItem';

describe('chatMediaItem', () => {
  it('defaults to an image and adds nothing when there is no extra', () => {
    expect(chatMediaItem('/api/media/chat/a.webp')).toEqual({ url: '/api/media/chat/a.webp', type: 'image' });
  });

  it('carries the report target, thumbnail and id through to the viewer item', () => {
    const report = { targetType: 'MESSAGE', targetId: 'm1' };
    expect(chatMediaItem('u', 'video', { report, thumb: 't', id: 'm1' }))
      .toEqual({ url: 'u', type: 'video', thumb: 't', id: 'm1', report });
  });

  it('ignores fields it does not know, and a non-object extra', () => {
    expect(chatMediaItem('u', 'image', { other: 1 })).toEqual({ url: 'u', type: 'image' });
    expect(chatMediaItem('u', 'image', 'x')).toEqual({ url: 'u', type: 'image' });
  });

  it('keeps the stored url so a forward from the viewer persists the key, not an absolute host', () => {
    expect(chatMediaItem('https://api.test/api/media/chat/a.webp', 'image', { rawUrl: '/api/media/chat/a.webp' }))
      .toEqual({ url: 'https://api.test/api/media/chat/a.webp', type: 'image', rawUrl: '/api/media/chat/a.webp' });
  });
});

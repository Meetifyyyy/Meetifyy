/**
 * The conversation list's line for a message: the same table as the server's
 * (backend messages/core/message-preview.ts), so a row patched from a live
 * event reads exactly as it will after the list refetches.
 *
 * Every path that wrote a preview used to have its own copy: a voice note was
 * "Audio" in one, "Media" in another and empty in a third, a shared post with
 * no text showed nothing, and anything that was not a photo or a video was
 * called "Audio". Only ever the message's own text or a label for its kind,
 * never a shared entity's content.
 */
import { inviteSummary } from './inviteSummary';

export const UNSENT_PREVIEW = 'This message was unsent';

const MEDIA_LABEL = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  voice: 'Voice message',
};

export function messagePreviewText(message) {
  if (!message || typeof message !== 'object') return '';
  if (message.state === 'UNSENT' || message.isUnsent) return UNSENT_PREVIEW;
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
  const text = String(message.text ?? payload.text ?? '').trim();
  if (text) return text;
  const invite = message.inviteData || payload.inviteData;
  if (invite) return inviteSummary(invite) || 'Group invite';
  const mediaType = String(message.mediaType || payload.mediaType || '').toLowerCase();
  if (message.mediaUrl || payload.mediaUrl || mediaType) {
    return MEDIA_LABEL[mediaType] || 'Attachment';
  }
  return 'Message';
}

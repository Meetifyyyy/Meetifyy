import { inviteSummary } from './invite-data';
import { payloadFields, stringOrEmpty } from './message-payload';

/**
 * What the conversation list shows under a chat's name for its latest
 * message: one function, for every kind of message.
 *
 * There were three copies (the REST send, the socket send, and the list's own
 * fallbacks) and they disagreed: a voice note was "Audio" on one path and an
 * empty preview on the other, anything that was not a photo or a video was
 * called "Audio", and a share with no text said nothing at all. The client
 * mirrors this table (frontend messagePreview.js), so a preview it patches in
 * from a live event reads exactly like the one the server stores.
 *
 * Only ever the message's own text or a label for its kind: never a shared
 * entity's content (a shared confession's text must not be copied anywhere,
 * see storableInviteData), never an id.
 */
export const UNSENT_PREVIEW = 'This message was unsent';

export interface PreviewSource {
  type?: string | null;
  state?: string | null;
  payload?: unknown;
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  voice: 'Voice message',
};

export function previewText(message: PreviewSource): string {
  if (message.state === 'UNSENT') return UNSENT_PREVIEW;
  const fields = payloadFields(message.payload ?? {});
  const text = stringOrEmpty(fields.text).trim();
  if (text) return text;
  if (fields.inviteData) {
    return inviteSummary(fields.inviteData) || 'Group invite';
  }
  const mediaType = stringOrEmpty(fields.mediaType).toLowerCase();
  if (fields.mediaUrl || mediaType) {
    return MEDIA_LABEL[mediaType] || 'Attachment';
  }
  return 'Message';
}

/**
 * The preview of a message as the send paths return it (its stored payload
 * and state), for the `conversation:updated` events that patch list rows.
 */
export function previewOf(message: {
  state?: string | null;
  payload?: unknown;
}): string {
  return previewText({ state: message.state, payload: message.payload });
}

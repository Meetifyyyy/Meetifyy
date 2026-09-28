export interface MessageResponseDto {
  id: string;
  conversationId: string;
  publicId?: string;
  internalId?: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  from?: 'me' | 'them';
  createdAt: Date | string;
  timestamp: Date | string;
  time: string;
  type: string;
  payload?: unknown;
  text: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  /** Stored mention objects ({ userId, username, start, end }), read from JSON. */
  mentions?: unknown[];
  inviteData?: unknown;
  replyTo?: unknown;
  status: string;
  state?: string;
  isUnsent?: boolean;
}

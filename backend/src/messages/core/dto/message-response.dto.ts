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
  payload?: any;
  text: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mentions?: string[];
  inviteData?: any;
  replyTo?: any;
  status: string;
  state?: string;
  isUnsent?: boolean;
  ciphertext?: string | null;
}

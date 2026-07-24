export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface PushProvider {
  send(userId: string, payload: PushNotificationPayload): Promise<boolean>;
}

export interface EmailProvider {
  sendEmail(userId: string, subject: string, body: string): Promise<boolean>;
}

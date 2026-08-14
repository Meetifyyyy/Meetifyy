import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  storageProvider: process.env.STORAGE_PROVIDER || 'supabase',
}));

export const supabaseConfig = registerAs('supabase', () => ({
  url: process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  anonKey: process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key',
  // Optional. When set, the API verifies user JWT signatures locally (HS256) with
  // zero network calls instead of calling Supabase Auth per token. Find it in the
  // Supabase dashboard → Project Settings → API → JWT Secret.
  jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
  bucketName: process.env.SUPABASE_BUCKET_NAME || 'meetifyy-dev',
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL || '',
}));

export const r2Config = registerAs('r2', () => ({
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  bucketName: process.env.R2_BUCKET_NAME || 'meetifyy-dev',
  publicUrl: process.env.R2_PUBLIC_URL || '',
}));

export const resendConfig = registerAs('resend', () => ({
  apiKey: process.env.RESEND_API_KEY || '',
  fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@meetifyy.app',
}));

export const emailConfig = registerAs('email', () => ({
  driver: process.env.EMAIL_DRIVER || 'mailpit',
  smtpHost: process.env.SMTP_HOST || '127.0.0.1',
  smtpPort: parseInt(process.env.SMTP_PORT || '1025', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  fromEmail: process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'noreply@meetifyy.app',
}));


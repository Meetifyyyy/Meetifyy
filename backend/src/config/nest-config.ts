import { registerAs } from '@nestjs/config';
import { config } from './config';

/**
 * `@nestjs/config` namespaces bound to the central config object.
 *
 * These exist so services already injecting `ConfigService` keep working — they
 * are views onto `config`, not a second source of truth. New code should import
 * `config` directly.
 */
export const appConfig = registerAs('app', () => ({
  ...config.app,
  nodeEnv: config.env,
  corsOrigins: config.app.cors.origins,
  storageProvider: config.storage.provider,
}));

export const supabaseConfig = registerAs('supabase', () => config.auth.supabase);
export const authConfig = registerAs('auth', () => config.auth);
export const databaseConfig = registerAs('database', () => config.database);
export const redisConfig = registerAs('redis', () => config.redis);
export const storageConfig = registerAs('storage', () => config.storage);
export const emailConfig = registerAs('email', () => ({
  ...config.email,
  smtpHost: config.email.smtp.host,
  smtpPort: config.email.smtp.port,
  smtpUser: config.email.smtp.user,
  smtpPass: config.email.smtp.pass,
  fromEmail: config.email.fromEmail,
}));

export const r2Config = registerAs('r2', () => config.storage.r2);
export const resendConfig = registerAs('resend', () => ({
  apiKey: config.email.resend.apiKey,
  fromEmail: config.email.fromEmail,
}));

export const featuresConfig = registerAs('features', () => config.features);
export const siteConfig = registerAs('site', () => config.site);

export const configNamespaces = [
  appConfig,
  supabaseConfig,
  authConfig,
  databaseConfig,
  redisConfig,
  storageConfig,
  emailConfig,
  r2Config,
  resendConfig,
  featuresConfig,
  siteConfig,
];

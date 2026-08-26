/**
 * Central configuration entry point.
 *
 * Import `config` from here — never `process.env` — anywhere in the backend.
 *
 *   import { config } from '../config';
 *   const link = `${config.app.frontendUrl}/reset-password`;
 *
 * Every slice is built at import time and validated as a whole, so a
 * misconfigured environment fails at boot with one message listing every
 * problem rather than at the first request that happens to need the value.
 */
import { APP_ENV, IS_DEVELOPMENT, IS_PRODUCTION, IS_STAGING, IS_TEST, assertEnvValid } from './env';
import { appConfigValues } from './app.config';
import { authConfigValues } from './auth.config';
import { databaseConfigValues } from './database.config';
import { emailConfigValues } from './email.config';
import { storageConfigValues } from './storage.config';
import { redisConfigValues } from './redis.config';
import { featuresConfigValues, loggingConfigValues } from './features.config';
import { siteConfigValues } from './site.config';
import { supportConfigValues } from './support.config';
import { monitoringConfigValues } from './monitoring.config';

export const config = {
  env: APP_ENV,
  isDevelopment: IS_DEVELOPMENT,
  isTest: IS_TEST,
  isStaging: IS_STAGING,
  isProduction: IS_PRODUCTION,

  app: appConfigValues,
  auth: authConfigValues,
  database: databaseConfigValues,
  email: emailConfigValues,
  storage: storageConfigValues,
  redis: redisConfigValues,
  features: featuresConfigValues,
  logging: loggingConfigValues,
  site: siteConfigValues,
  support: supportConfigValues,
  monitoring: monitoringConfigValues,
} as const;

// Every slice has now been evaluated, so this reports the complete set of
// problems in one throw.
assertEnvValid();

export type Config = typeof config;

export { APP_ENV, IS_DEVELOPMENT, IS_TEST, IS_STAGING, IS_PRODUCTION } from './env';
export type { AppEnvironment } from './env';

/**
 * Public surface of the configuration layer.
 *
 *   import { config } from '../config';
 */
export { config, APP_ENV, IS_DEVELOPMENT, IS_TEST, IS_STAGING, IS_PRODUCTION } from './config';
export type { Config } from './config';
export type { AppEnvironment } from './env';
export * from './nest-config';

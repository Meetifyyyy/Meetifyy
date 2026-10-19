import { config } from '../../config';

type PushFlags = {
  enabled: boolean;
  web: boolean;
  fcm: boolean;
};

/**
 * Flips the push config for a spec. `config` is built once at import from the
 * (empty, test) environment, so specs set the flags the code reads rather than
 * environment variables. Returns a restore function for afterEach.
 */
export function setPushConfig(flags: PushFlags): () => void {
  const saved = {
    enabled: config.push.enabled,
    web: config.push.web.configured,
    fcm: config.push.fcm.configured,
  };
  const apply = (f: PushFlags) => {
    Object.defineProperty(config.push, 'enabled', {
      value: f.enabled,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(config.push.web, 'configured', {
      value: f.web,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(config.push.fcm, 'configured', {
      value: f.fcm,
      writable: true,
      configurable: true,
    });
  };
  apply(flags);
  return () => apply(saved);
}

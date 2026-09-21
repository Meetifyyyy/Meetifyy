import { AppVersionController } from './app-version.controller';
import { config } from '../config';

/**
 * The gate's server half. What matters is not the shape of the JSON but that
 * the DEFAULTS gate nobody: these variables will be unset in most environments
 * for most of this app's life, and a version gate that switches itself on by
 * omission locks every user out of a working app with no way to reach them.
 */
describe('AppVersionController', () => {
  const controller = new AppVersionController();

  it('serves a row per platform', () => {
    const body = controller.getVersion();
    expect(body).toHaveProperty('android.minimumVersion');
    expect(body).toHaveProperty('android.latestVersion');
    expect(body).toHaveProperty('ios.minimumVersion');
    expect(body).toHaveProperty('ios.latestVersion');
  });

  it('defaults to 0.0.0, which gates nobody', () => {
    // Guards the default in app.config.ts. If someone "tidies" it to the
    // current release, every unset environment starts blocking users.
    expect(config.app.mobile.android.minimum).toBe('0.0.0');
    expect(config.app.mobile.ios.minimum).toBe('0.0.0');
  });

  it('reports a missing store URL as null rather than an empty string', () => {
    // The client renders a button only when there is somewhere to send the
    // user; '' is truthy enough to slip through a careless check.
    const body = controller.getVersion();
    expect(body.android.updateUrl).toBeNull();
    expect(body.ios.updateUrl).toBeNull();
  });
});

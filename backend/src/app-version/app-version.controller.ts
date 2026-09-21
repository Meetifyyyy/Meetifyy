import { Controller, Get } from '@nestjs/common';

import { CacheControl } from '../common/decorators/cache-control.decorator';
import { config } from '../config';

/**
 * What version the installed apps are expected to be on.
 *
 * DELIBERATELY PUBLIC AND DELIBERATELY TRIVIAL
 * This is the one request an app on an unsupported build must still be able to
 * make. Putting it behind authentication would mean a user stuck on an old
 * version could only be told to upgrade after signing in — and if the reason
 * the build is unsupported is that the auth contract changed, they never get
 * that far. It reads configuration and touches nothing else, so it cannot fail
 * for any reason the rest of the API can fail for.
 *
 * WHY IT SERVES BOTH PLATFORMS AT ONCE
 * No query parameter, so there is exactly one response to cache and no way for
 * a client to ask the wrong question. The app picks its own row; the payload is
 * a few hundred bytes either way.
 */
@Controller('api/app')
export class AppVersionController {
  @Get('version')
  /**
   * `@CacheControl`, not a raw `@Header`: `NoCacheInterceptor` rewrites the
   * header for every route and defaults it to `no-store`, so a header set
   * directly is silently overwritten. It was, on the first version of this
   * file — the comment below claimed a sixty-second cache the endpoint was not
   * actually serving.
   *
   * Short on purpose. Raising the floor is something you do because a build is
   * actively broken, and waiting an hour for a CDN to forget the old answer is
   * the wrong trade. Sixty seconds still absorbs a cold-start stampede after a
   * store rollout.
   */
  @CacheControl('public, max-age=60')
  getVersion() {
    const { android, ios } = config.app.mobile;
    return {
      android: {
        minimumVersion: android.minimum,
        latestVersion: android.latest,
        updateUrl: android.url || null,
      },
      ios: {
        minimumVersion: ios.minimum,
        latestVersion: ios.latest,
        updateUrl: ios.url || null,
      },
    };
  }
}

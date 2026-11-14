import { HealthController } from './health.controller';
import { config } from '../config';

/**
 * `/health` is what the frontend build waits on before shipping, so the shape
 * of this response is a deploy dependency rather than a convenience. The
 * commit comes from config (ID-28), which reads GIT_COMMIT_SHA.
 */
describe('HealthController', () => {
  const controller = new HealthController();

  afterEach(() => jest.restoreAllMocks());

  it('reports liveness', () => {
    expect(controller.check().status).toBe('ok');
  });

  it('reports the commit it was built from', () => {
    jest.replaceProperty(config.app.observability, 'gitCommitSha', 'abc123');
    expect(controller.check().commit).toBe('abc123');
  });

  it('reports null rather than a placeholder when unset', () => {
    jest.replaceProperty(config.app.observability, 'gitCommitSha', '');
    // The gate treats null as "cannot tell" and waits; a made-up value would
    // read as a match and let the frontend ship early.
    expect(controller.check().commit).toBeNull();
  });
});

import { HealthController } from './health.controller';

/**
 * `/health` is what the frontend build waits on before shipping, so the shape
 * of this response is a deploy dependency rather than a convenience.
 */
describe('HealthController', () => {
  const controller = new HealthController();
  const original = process.env.GIT_COMMIT_SHA;

  afterEach(() => {
    if (original === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = original;
  });

  it('reports liveness', () => {
    expect(controller.check().status).toBe('ok');
  });

  it('reports the commit it was built from', () => {
    process.env.GIT_COMMIT_SHA = 'abc123';
    expect(controller.check().commit).toBe('abc123');
  });

  it('reports null rather than a placeholder when unset', () => {
    delete process.env.GIT_COMMIT_SHA;
    // The gate treats null as "cannot tell" and waits; a made-up value would
    // read as a match and let the frontend ship early.
    expect(controller.check().commit).toBeNull();
  });
});

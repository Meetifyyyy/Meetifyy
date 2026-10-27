/**
 * When the API's Sentry starts, and why it stays off. Each case loads
 * instrument.ts afresh against its own configuration; the SDK is mocked, so
 * nothing is ever sent.
 */
type Obs = {
  sentryDsn: string;
  sentryEnabled: boolean;
  sentryEnvironment: string;
  sentryRelease: string;
  gitCommitSha: string;
  sentryReportLocal: boolean;
  sentryTracesSampleRate: number;
  sentryProfilesSampleRate: number;
};

const DSN = 'https://key@o1.ingest.us.sentry.io/2';

function load(env: string, obs: Partial<Obs>) {
  const init = jest.fn();
  let reason: string | null = null;
  jest.isolateModules(() => {
    jest.doMock('@sentry/nestjs', () => ({ init }));
    jest.doMock('@sentry/profiling-node', () => ({
      nodeProfilingIntegration: () => ({}),
    }));
    jest.doMock('./config', () => ({
      config: {
        env,
        app: {
          observability: {
            sentryDsn: DSN,
            sentryEnabled: true,
            sentryEnvironment: '',
            sentryRelease: '',
            gitCommitSha: '',
            sentryReportLocal: false,
            sentryTracesSampleRate: 0,
            sentryProfilesSampleRate: 0,
            ...obs,
          },
        },
      },
    }));
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const mod = jest.requireActual<{
      sentryDisabledReason: () => string | null;
    }>('./instrument');
    reason = mod.sentryDisabledReason();
  });
  return { reason, init };
}

describe('API Sentry start-up rules', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports from a deployment, tagged with its environment and release', () => {
    const { reason, init } = load('development', { gitCommitSha: 'abc123' });
    expect(reason).toBeNull();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'development',
        release: 'meetifyy-api@abc123',
      }),
    );
  });

  it('stays off for a local development run with no release', () => {
    const { reason, init } = load('development', {});
    expect(reason).toMatch(/local run/);
    expect(init).not.toHaveBeenCalled();
  });

  it('lets a local run report when asked to', () => {
    const { reason, init } = load('development', { sentryReportLocal: true });
    expect(reason).toBeNull();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ release: undefined }),
    );
  });

  it('never applies the local rule to production', () => {
    const { reason, init } = load('production', {});
    expect(reason).toBeNull();
    expect(init).toHaveBeenCalled();
  });

  it('drops the node-postgres integration and keeps the rest', () => {
    const { init } = load('development', { gitCommitSha: 'abc123' });
    const [{ integrations }] = init.mock.calls[0] as [
      { integrations: (defaults: { name: string }[]) => { name?: string }[] },
    ];
    const names = integrations([
      { name: 'Http' },
      { name: 'Postgres' },
      { name: 'Prisma' },
    ]).map((integration) => integration.name);
    expect(names).not.toContain('Postgres');
    expect(names).toEqual(expect.arrayContaining(['Http', 'Prisma']));
  });

  it('stays off when the environment cross-check disagrees', () => {
    const { reason, init } = load('development', {
      gitCommitSha: 'abc123',
      sentryEnvironment: 'production',
    });
    expect(reason).toMatch(/does not match/);
    expect(init).not.toHaveBeenCalled();
  });
});

import 'reflect-metadata';

import {
  AdminAnalyticsService,
  type ServiceReport,
} from './admin-analytics.service';
import { config } from '../../config';

/**
 * The Azure panel.
 *
 * Every request shape here was checked against live Azure before these tests
 * were written, so the fixtures are recorded responses rather than invented
 * ones: the Container App read and the Cost Management query were both issued
 * against the production subscription, and the cost query answered HTTP 429 on
 * the first attempt and 200 on the next. That 429 is why the spend cache
 * exists, and it is why it is tested here.
 */

type Metric = NonNullable<ServiceReport['metrics']>[number];

/** The private surface these tests drive, named rather than cast to `any`. */
interface AzureInternals {
  probeAzure(): Promise<ServiceReport>;
  azureSpendCache: { metrics: Metric[]; at: number } | null;
  azureToken(): Promise<string>;
}

const internals = (svc: AdminAnalyticsService): AzureInternals =>
  svc as unknown as AzureInternals;

interface Reply {
  status: number;
  body: unknown;
}
type Handler = (url: string) => Reply;

const TOKEN_OK: Reply = {
  status: 200,
  body: { access_token: 't0', expires_in: 3600 },
};

/** The Container App payload, trimmed to the fields the probe reads. */
const APP_OK: Reply = {
  status: 200,
  body: {
    properties: {
      runningStatus: 'Running',
      latestReadyRevisionName: 'meetifyy-api--0000014',
      template: {
        scale: { minReplicas: 1, maxReplicas: 3 },
        containers: [{ resources: { cpu: 0.5, memory: '1Gi' } }],
      },
    },
  },
};

/** Column order is not contractual, so the probe locates both values by name. */
const COST_OK: Reply = {
  status: 200,
  body: {
    properties: {
      columns: [
        { name: 'Cost', type: 'Number' },
        { name: 'Currency', type: 'String' },
      ],
      rows: [[27.2853892555898, 'INR']],
    },
  },
};

function build(handler: Handler) {
  const calls: string[] = [];
  const fetchMock = jest.fn((url: unknown) => {
    calls.push(String(url));
    const { status, body } = handler(String(url));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  global.fetch = fetchMock;

  const svc = new AdminAnalyticsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc: internals(svc), calls };
}

type Route = 'token' | 'cost' | 'app';
const route = (url: string): Route =>
  url.includes('/oauth2/')
    ? 'token'
    : url.includes('Microsoft.CostManagement')
      ? 'cost'
      : 'app';

/** Routes each call to a fixture, so a test only names what differs. */
const serve =
  (over: Partial<Record<Route, Reply>> = {}): Handler =>
  (url) => {
    const base: Record<Route, Reply> = {
      token: TOKEN_OK,
      app: APP_OK,
      cost: COST_OK,
    };
    return over[route(url)] ?? base[route(url)];
  };

const azure = () =>
  config.analytics.providers.azure as unknown as Record<string, string>;

const find = (report: ServiceReport, label: string): Metric | undefined =>
  (report.metrics ?? []).find((m) => m.label === label);

describe('AdminAnalyticsService - Azure panel', () => {
  const original = { ...azure() };

  beforeEach(() => {
    Object.assign(azure(), {
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      subscriptionId: 'sub',
      resourceGroup: 'meetifyy-prod-rg',
      containerApp: 'meetifyy-api',
    });
  });

  afterEach(() => {
    Object.assign(azure(), original);
    jest.restoreAllMocks();
  });

  it('names the exact variables that are missing rather than "not configured"', async () => {
    Object.assign(azure(), { clientSecret: '', subscriptionId: '' });
    const { svc, calls } = build(serve());

    const report = await svc.probeAzure();

    expect(report.state).toBe('NOT_CONFIGURED');
    expect(report.detail).toContain('AZURE_CLIENT_SECRET');
    expect(report.detail).toContain('AZURE_SUBSCRIPTION_ID');
    // The ones that ARE set must not be blamed.
    expect(report.detail).not.toContain('AZURE_TENANT_ID');
    // Nothing should be dialled when credentials are absent.
    expect(calls).toHaveLength(0);
  });

  it('reports the live app and spend figures', async () => {
    const { svc } = build(serve());

    const report = await svc.probeAzure();

    expect(report.state).toBe('UP');
    expect(find(report, 'App status')?.value).toBe('Running');
    expect(find(report, 'Active revision')?.value).toBe(
      'meetifyy-api--0000014',
    );
    expect(find(report, 'CPU per replica')?.value).toBe('0.5 vCPU');
    expect(find(report, 'Memory per replica')?.value).toBe('1Gi');
    // The bar is drawn against the platform's real ceiling.
    expect(find(report, 'Replicas')).toMatchObject({ value: 1, limit: 3 });
    // Rounded for display, currency taken from the billing account.
    expect(find(report, 'Spend this month')?.value).toBe('27.29 INR');
  });

  it('stays UP when spend is forbidden, and says which role is needed', async () => {
    const { svc } = build(serve({ cost: { status: 403, body: {} } }));

    const report = await svc.probeAzure();

    // A billing permission must never make the running API look down.
    expect(report.state).toBe('UP');
    expect(report.detail).toContain('Cost Management Reader');
    expect(find(report, 'App status')).toBeDefined();
    expect(find(report, 'Spend this month')).toBeUndefined();
  });

  it('serves the last good spend when Azure rate-limits, labelled with its age', async () => {
    let cost: Reply = COST_OK;
    const { svc } = build((url) =>
      route(url) === 'cost' ? cost : serve()(url),
    );

    // Prime the cache with a good read.
    const first = await svc.probeAzure();
    expect(find(first, 'Spend this month')?.value).toBe('27.29 INR');

    // Expire it, then have Azure answer 429 - the case seen on the very first
    // live call. The figure must survive rather than flickering out.
    const cache = svc.azureSpendCache;
    expect(cache).not.toBeNull();
    cache!.at = Date.now() - 60 * 60 * 1000;
    cost = { status: 429, body: {} };

    const second = await svc.probeAzure();

    expect(second.state).toBe('UP');
    expect(find(second, 'Spend this month')?.value).toBe('27.29 INR');
    expect(second.detail).toContain('rate-limited');
    expect(second.detail).toMatch(/Showing spend from \d+m ago/);
  });

  it('does not re-mint a token it already holds', async () => {
    const { svc, calls } = build(serve());
    const tokenCalls = () => calls.filter((u) => u.includes('/oauth2/')).length;

    await svc.probeAzure();
    expect(tokenCalls()).toBe(1);

    // Force the spend path to run again rather than being served from cache.
    svc.azureSpendCache = null;
    await svc.probeAzure();

    expect(tokenCalls()).toBe(1);
  });

  it('reports DOWN with the reason when sign-in fails', async () => {
    const { svc } = build(
      serve({
        token: {
          status: 401,
          body: {
            error_description:
              'AADSTS7000215: Invalid client secret.\nTrace ID: abc',
          },
        },
      }),
    );

    const report = await svc.probeAzure();

    expect(report.state).toBe('DOWN');
    expect(report.detail).toContain('AADSTS7000215');
    // Only the actionable first line - not the trace id noise.
    expect(report.detail).not.toContain('Trace ID');
  });

  it('asks for the resource group and app name before promising replica figures', async () => {
    Object.assign(azure(), { resourceGroup: '', containerApp: '' });
    const { svc, calls } = build(serve());

    const report = await svc.probeAzure();

    expect(report.state).toBe('UP');
    expect(report.detail).toContain('AZURE_RESOURCE_GROUP');
    // Spend still works without naming an app.
    expect(find(report, 'Spend this month')).toBeDefined();
    expect(calls.some((u) => u.includes('Microsoft.App'))).toBe(false);
  });
});

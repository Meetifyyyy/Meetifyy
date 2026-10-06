import {
  ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { stub } from '../testing/stub';

interface FakeScope {
  tags: Record<string, string>;
  user?: { id: string };
  context?: Record<string, unknown>;
  setTag: jest.Mock<void, [string, string]>;
  setUser: jest.Mock<void, [{ id: string }]>;
  setContext: jest.Mock<void, [string, Record<string, unknown>]>;
}

const captured: Array<{ error: unknown; scope: FakeScope }> = [];
let currentScope: FakeScope | null = null;

jest.mock('@sentry/nestjs', () => ({
  withScope: (fn: (scope: FakeScope) => void) => {
    const scope: FakeScope = {
      tags: {},
      setTag: jest.fn((k: string, v: string) => {
        scope.tags[k] = v;
      }),
      setUser: jest.fn((u: { id: string }) => {
        scope.user = u;
      }),
      setContext: jest.fn((_n: string, c: Record<string, unknown>) => {
        scope.context = c;
      }),
    };
    currentScope = scope;
    fn(scope);
    currentScope = null;
  },
  captureException: (error: unknown) => {
    if (currentScope) captured.push({ error, scope: currentScope });
  },
}));

// Imported after the mock is registered.
import { HttpExceptionFilter } from './http-exception.filter';

interface ErrorBody {
  statusCode: number;
  message: unknown;
  [key: string]: unknown;
}

describe('HttpExceptionFilter → Sentry', () => {
  const filter = new HttpExceptionFilter();

  beforeEach(() => {
    captured.length = 0;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const run = (exception: unknown) => {
    const json = jest.fn<void, [ErrorBody]>();
    const status = jest.fn(() => ({ json }));
    const host = stub<ArgumentsHost>({
      switchToHttp: () => ({
        getResponse: () => ({ status, json, headersSent: false }),
        getRequest: () => ({
          method: 'POST',
          url: '/api/messages/abc?token=secret',
          originalUrl: '/api/messages/abc?token=secret',
          baseUrl: '/api/messages',
          route: { path: '/:id' },
          body: { text: 'a private message', password: 'hunter2' },
          headers: { 'x-request-id': 'req-1' },
          user: { id: 'user-1', email: 'someone@example.com' },
        }),
      }),
    });
    filter.catch(exception, host);
    const body = json.mock.calls[0]?.[0];
    if (!body) throw new Error('the filter sent no body');
    return { status, body };
  };

  it('reports an unexpected error with route, method, status and user id only', () => {
    const error = new Error('db exploded');
    const { status, body } = run(error);

    expect(captured).toHaveLength(1);
    const { error: sent, scope } = captured[0];
    expect(sent).toBe(error);
    expect(scope.tags).toMatchObject({
      route: '/api/messages/:id',
      'http.method': 'POST',
      'http.status_code': '500',
      feature: 'messages',
    });
    expect(scope.user).toEqual({ id: 'user-1' });
    // Nothing from the body reaches the report.
    expect(JSON.stringify(scope)).not.toMatch(
      /private message|hunter2|someone@/,
    );

    // The client still gets the same safe answer as before.
    expect(status).toHaveBeenCalledWith(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toMatch(/db exploded/);
  });

  it('reports a thrown 5xx HttpException', () => {
    run(new InternalServerErrorException('boom'));
    expect(captured).toHaveLength(1);
  });

  it('does not report expected 4xx outcomes', () => {
    run(new BadRequestException('nope'));
    expect(captured).toHaveLength(0);
  });
});

import { ForbiddenException, NotFoundException, BadRequestException, ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

/**
 * The filter rebuilds every error body, so anything a caller relies on has to be
 * explicitly carried through. The activity access policy's `code` is one such
 * contract: the client picks its access-denied UI state from it.
 */
describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  const run = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json, headersSent: false }),
        getRequest: () => ({ method: 'GET', url: '/api/activities/act-1', body: {} }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return { status, body: json.mock.calls[0]?.[0] };
  };

  it('passes a policy code through to the client', () => {
    const { status, body } = run(
      new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'COLLEGE_RESTRICTED',
        message: "You can't access this activity because it's from another college.",
      }),
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(body.code).toBe('COLLEGE_RESTRICTED');
    expect(body.message).toMatch(/another college/i);
  });

  it('passes the PRIVATE code through', () => {
    const { body } = run(
      new ForbiddenException({ statusCode: 403, code: 'PRIVATE', message: 'This activity is private and you do not have access.' }),
    );
    expect(body.code).toBe('PRIVATE');
  });

  it('omits `code` entirely for ordinary exceptions', () => {
    expect(run(new NotFoundException('Activity not found')).body).not.toHaveProperty('code');
    expect(run(new BadRequestException('Title is required')).body).not.toHaveProperty('code');
  });

  it('never echoes extra fields from the thrown body', () => {
    const { body } = run(
      new ForbiddenException({
        statusCode: 403,
        code: 'PRIVATE',
        message: 'This activity is private and you do not have access.',
        title: 'Secret rooftop dinner',
        attendees: ['user-1'],
      } as any),
    );
    expect(Object.keys(body).sort()).toEqual(['code', 'message', 'path', 'statusCode', 'timestamp']);
  });

  it('reports a non-HTTP error as a 500 without leaking its content', () => {
    const { status, body } = run(new Error('connect ECONNREFUSED 10.0.0.1:5432'));
    expect(status).toHaveBeenCalledWith(500);
    expect(body.message).toBe('Internal server error');
  });
});

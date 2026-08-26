import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config';

/**
 * Protects development-only routes.
 *
 * The dev email preview endpoints were reachable by anyone on the internet:
 * their only protection was `enableDevEndpoints`, which is derived from
 * APP_ENV. A deployment with APP_ENV unset believes it is a development box,
 * registers the controller, and exposes an unauthenticated route that enqueues
 * email jobs. One mis-set variable should not be the only thing standing
 * between the internet and a dev route, so this adds a second, independent
 * barrier.
 *
 * Two ways to pass, in order:
 *   1. DEV_ENDPOINT_TOKEN is set and the `x-dev-token` header matches it.
 *   2. No token is configured and the request originates from loopback.
 */
@Injectable()
export class DevEndpointGuard implements CanActivate {
  private readonly logger = new Logger(DevEndpointGuard.name);

  canActivate(context: ExecutionContext): boolean {
    // Independent of route registration: holds even if the controller is
    // mounted somewhere it should never have been.
    if (!config.features.enableDevEndpoints) {
      throw new ForbiddenException('Dev endpoints are disabled');
    }

    const request = context.switchToHttp().getRequest();
    const token = config.features.devEndpointToken;

    if (token) {
      const provided = request.headers['x-dev-token'];
      if (typeof provided === 'string' && equalsConstantTime(provided, token)) return true;
      this.logger.warn(`dev_endpoint_denied ${JSON.stringify({ path: request.url, reason: 'bad-token' })}`);
      throw new ForbiddenException('Dev endpoints require a valid x-dev-token header');
    }

    if (isLoopback(remoteAddress(request))) return true;

    this.logger.warn(
      `dev_endpoint_denied ${JSON.stringify({ path: request.url, reason: 'not-loopback' })}`,
    );
    throw new ForbiddenException(
      'Dev endpoints are restricted to loopback. Set DEV_ENDPOINT_TOKEN to reach them from elsewhere.',
    );
  }
}

/** The address the request actually arrived from; proxy headers are never trusted here. */
function remoteAddress(request: any): string {
  return (request.socket?.remoteAddress || request.raw?.socket?.remoteAddress || '').toString();
}

function isLoopback(address: string): boolean {
  if (!address) return false;
  // Node reports IPv4 loopback over a dual-stack socket as ::ffff:127.0.0.1.
  const normalized = address.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.');
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

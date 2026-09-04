import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import {
  applyRateLimitHeaders,
  rateLimitException,
} from '../rate-limit/rate-limit.response';
import { clientIp } from '../rate-limit/client-ip.util';

/**
 * Abuse control for the unauthenticated support endpoints.
 *
 * Two budgets, both of which must pass:
 *
 *  - per IP, which stops one host filling the queue;
 *  - per submitted email address, which stops a botnet spread across many IPs
 *    from mailing one victim's inbox a confirmation for every request it files.
 *    The confirmation email goes to whatever address the form carries, so
 *    without this the endpoint is a mail amplifier pointed at an address the
 *    sender does not control.
 *
 * Both budgets are consumed even when the first rejects, so the cheaper key
 * cannot be probed indefinitely — that behaviour is now in
 * RateLimitService.consumeAll and shared with every other composite policy.
 *
 * Values are unchanged (5/hour per IP, 3/hour per address). What changed:
 * the IP is `req.ip` rather than a client-supplied header, the email is hashed
 * before it becomes a Redis key, and a Redis outage falls back to in-process
 * counting instead of removing the control.
 */
@Injectable()
export class SupportRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest();

    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : null;

    const decision = await this.rateLimit.consumeAll([
      { policy: 'support.request.ip', identifier: clientIp(request) },
      ...(email
        ? [{ policy: 'support.request.email' as const, identifier: email }]
        : []),
    ]);

    applyRateLimitHeaders(http.getResponse(), decision);

    if (!decision.allowed) {
      throw rateLimitException(decision, request?.id);
    }

    return true;
  }
}

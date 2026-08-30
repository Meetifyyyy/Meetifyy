import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The authenticated user, or one property of it.
 *
 * `@CurrentUser()` gives the whole payload; `@CurrentUser('id')` gives just
 * that field. The `data` argument used to be accepted and then ignored, so
 * every `@CurrentUser('id') userId: string` was silently handed the entire user
 * object instead of the id — which then reached Prisma as `where: { id: {...} }`
 * and threw. It is the only reason the verification endpoints failed even once
 * they were reachable.
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (!data) return user;
    return user ? user[data] : undefined;
  },
);

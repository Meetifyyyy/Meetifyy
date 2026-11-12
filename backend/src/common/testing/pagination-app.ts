import type { Server } from 'http';
import { ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../validation/global-validation-pipe.options';

/**
 * A real Nest HTTP app around one controller, so a pipe on a query parameter
 * actually runs. Calling a handler method directly skips pipes entirely, which
 * is why a pagination bound tested that way proves nothing.
 *
 * The guards are replaced with ones that sign the request in as a fixed user
 * and admin; every provider the controller injects is a stub the caller gives,
 * so a test sees exactly what reached the service.
 *
 * `validate: true` installs the same global ValidationPipe `main.ts` does, so a
 * body DTO is exercised the way production runs it — which is the only way to
 * learn that an oversized array or a wrong type is a 400.
 */
export async function createPaginationApp(options: {
  controller: Type<unknown>;
  guards: Type<unknown>[];
  providers: { provide: Type<unknown>; useValue: object }[];
  validate?: boolean;
}): Promise<INestApplication<Server>> {
  let builder = Test.createTestingModule({
    controllers: [options.controller],
    providers: options.providers,
  });
  for (const guard of options.guards) {
    builder = builder.overrideGuard(guard).useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx
          .switchToHttp()
          .getRequest<{ user?: object; admin?: object }>();
        req.user = { id: 'user-1' };
        req.admin = { id: 'admin-1' };
        return true;
      },
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<Server>>();
  if (options.validate) {
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
  }
  await app.init();
  return app;
}

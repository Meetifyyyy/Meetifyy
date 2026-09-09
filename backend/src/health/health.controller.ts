import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /**
   * Liveness, and which build is answering.
   *
   * `commit` exists so a deploy can be waited on from outside. The frontend and
   * the API ship from one repository through two independent pipelines — a
   * GitHub Action for the container, Vercel for the bundle — and nothing
   * coordinated them, so the faster of the two won. That order matters: a
   * frontend expecting cookie sessions against a backend that does not issue
   * them yet signs everybody out for the length of the gap.
   *
   * Reporting the commit lets the frontend build gate on the API having caught
   * up (see scripts/await-backend.sh). Unset in local development, where there
   * is nothing to wait for.
   */
  @Get()
  check() {
    return {
      status: 'ok',
      commit: process.env.GIT_COMMIT_SHA || null,
      timestamp: new Date().toISOString(),
    };
  }
}

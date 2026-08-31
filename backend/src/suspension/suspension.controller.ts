import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';

import { JwtGuard } from '../common/guards/jwt.guard';
import { AllowSuspended } from '../common/decorators/allow-suspended.decorator';
import { SuspensionService } from './suspension.service';

export class SubmitSuspensionAppealDto {
  @IsString()
  @Length(20, 4000, {
    message:
      'Tell us a little more — at least 20 characters — so the review team has something to go on.',
  })
  message!: string;
}

/**
 * The only surface a suspended account may use.
 *
 * Both routes carry `@AllowSuspended()`, which is what lets them through the
 * suspension gate in `JwtGuard`; every other authenticated route stays refused.
 * They are still behind `JwtGuard`, so an appeal is always attributable to the
 * signed-in account and the message body can never nominate someone else.
 */
@UseGuards(JwtGuard)
@Controller('api/suspension')
export class SuspensionController {
  constructor(private readonly suspension: SuspensionService) {}

  /**
   * What the suspension screen renders.
   *
   * Served from the server rather than inferred on the client, so the screen
   * cannot be dismissed by editing local state.
   */
  @AllowSuspended()
  @Get('status')
  async getStatus(@Req() req: AuthenticatedRequest) {
    return this.suspension.getStatus(req.user.id);
  }

  @AllowSuspended()
  @Post('appeal')
  async submitAppeal(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitSuspensionAppealDto,
  ) {
    return this.suspension.submitAppeal(req.user.id, dto.message, {
      ip:
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip ||
        'unknown',
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }
}

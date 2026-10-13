import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import { TrendingResult, TrendingService } from './trending.service';

@Controller('api/trending')
@UseGuards(JwtGuard)
export class TrendingController {
  constructor(private readonly trending: TrendingService) {}

  /** Rising hashtags on the viewer's campus (or everywhere, if it is quiet). */
  @Get('hashtags')
  async hashtags(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TrendingResult> {
    return this.trending.forUser(user.id);
  }
}

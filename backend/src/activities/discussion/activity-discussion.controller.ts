import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ActivityDiscussionService } from './activity-discussion.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';

@Controller('api/activities/:activityId/discussion')
@UseGuards(JwtGuard)
export class ActivityDiscussionController {
  constructor(private readonly discussionService: ActivityDiscussionService) {}

  @Get()
  async getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('activityId') activityId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = parseInt(limit || '', 10);
    const limitNum = !isNaN(parsed) && parsed > 0 ? parsed : 20;
    return this.discussionService.getMessages(
      activityId,
      user?.id,
      before,
      limitNum,
    );
  }

  /**
   * Not selfie-gated: posting in an activity's discussion is participation in
   * an activity the caller already belongs to, not messaging. The selfie gate
   * is kept only on messaging, creating posts/communities/activities and
   * Instant Match (docs/college-affiliation.md → Selfie gate).
   */
  @Post()
  async sendMessage(
    @Param('activityId') activityId: string,
    @Body('text') text: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.discussionService.sendMessage(activityId, user?.id, text);
  }
}

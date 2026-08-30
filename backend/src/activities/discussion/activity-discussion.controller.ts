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
import { VerifiedOnly } from '../../common/decorators/verified-only.decorator';

@Controller('api/activities/:activityId/discussion')
@UseGuards(JwtGuard)
export class ActivityDiscussionController {
  constructor(private readonly discussionService: ActivityDiscussionService) {}

  @Get()
  async getMessages(
    @CurrentUser() user: any,
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
   * Every other write on an activity is `@VerifiedOnly()`; this one was not,
   * which left a messaging surface open to an account whose verification had
   * been revoked after it joined. Joining is gated, so the gap only showed up
   * on exactly the case the gate exists for: someone who was eligible when
   * they joined and is not any more.
   */
  @Post()
  @VerifiedOnly()
  async sendMessage(
    @Param('activityId') activityId: string,
    @Body('text') text: string,
    @CurrentUser() user: any,
  ) {
    return this.discussionService.sendMessage(activityId, user?.id, text);
  }
}

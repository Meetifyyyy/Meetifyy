import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ActivityDiscussionService } from './activity-discussion.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/activities/:activityId/discussion')
@UseGuards(JwtGuard)
export class ActivityDiscussionController {
  constructor(private readonly discussionService: ActivityDiscussionService) {}

  @Get()
  async getMessages(
    @Param('activityId') activityId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = parseInt(limit || '', 10);
    const limitNum = !isNaN(parsed) && parsed > 0 ? parsed : 20;
    return this.discussionService.getMessages(activityId, before, limitNum);
  }

  @Post()
  async sendMessage(
    @Param('activityId') activityId: string,
    @Body('text') text: string,
    @CurrentUser() user: any,
  ) {
    return this.discussionService.sendMessage(activityId, user?.id, text);
  }
}

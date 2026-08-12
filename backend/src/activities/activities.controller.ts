import { Controller, Get, Param, Post, Delete, Query, Body, UseGuards } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateActivityDto } from './dto/activity.dto';
import { CacheControl } from '../common/decorators/cache-control.decorator';

@Controller('api/activities')
@UseGuards(JwtGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  // @CacheControl removed: browser caching cannot be invalidated and causes
  // stale data when navigating back after joining. Relies on backend Redis cache.
  async getAllActivities(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('scope') scope?: string
  ) {
    const rawLimit = parseInt(limit || '', 10);
    const parsedLimit = !isNaN(rawLimit) && rawLimit > 0 ? rawLimit : 20;
    const allowedScopes = ['public', 'college', 'one_on_one'] as const;
    const parsedScope = (allowedScopes as readonly string[]).includes(scope || '')
      ? (scope as 'public' | 'college' | 'one_on_one')
      : 'public';
    return this.activitiesService.getAllActivities(user?.id, parsedLimit, cursor, parsedScope);
  }

  @Get('discover')
  async getCrewDiscover(@CurrentUser() user: any) {
    return this.activitiesService.getCrewDiscover(user.id);
  }

  @Get('me')
  // @CacheControl removed
  async getMyActivities(@CurrentUser() user: any) {
    return this.activitiesService.getMyActivities(user.id);
  }

  @Get('bookmarks')
  // @CacheControl removed
  async getSavedActivities(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.activitiesService.getSavedActivities(user.id, parsedLimit, cursor);
  }

  @Get('bookmarks/ids')
  async getSavedActivityIds(@CurrentUser() user: any) {
    return this.activitiesService.getSavedActivityIds(user.id);
  }

  @Get('invitations/me')
  async getPendingInvitations(@CurrentUser() user: any) {
    return this.activitiesService.getPendingInvitations(user.id);
  }

  @Post('invitations/:invitationId/accept')
  async acceptInvitation(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.acceptInvitation(invitationId, user.id);
  }

  @Post('invitations/:invitationId/decline')
  async declineInvitation(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.declineInvitation(invitationId, user.id);
  }

  @Post(':id/bookmark')
  async bookmarkActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.bookmarkActivity(id, user.id);
  }

  @Delete(':id/bookmark')
  async unbookmarkActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.unbookmarkActivity(id, user.id);
  }

  @Get(':id')
  @CacheControl('no-store')
  async getActivityById(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.getActivityById(id, user?.id);
  }

  @Post()
  async createActivity(@Body() data: CreateActivityDto, @CurrentUser() user: any) {
    return this.activitiesService.createActivity(data, user.id);
  }

  @Post(':id/join')
  async joinActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.joinActivity(id, user.id);
  }

  @Post(':id/leave')
  async leaveActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.leaveActivity(id, user.id);
  }

  @Post(':id/request')
  async requestToJoinActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.requestToJoinActivity(id, user.id);
  }

  @Post(':id/requests/:userId/accept')
  async acceptJoinRequest(
    @Param('id') id: string,
    @Param('userId') requesterId: string,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.acceptJoinRequest(id, user.id, requesterId);
  }

  @Post(':id/requests/:userId/reject')
  async rejectJoinRequest(
    @Param('id') id: string,
    @Param('userId') requesterId: string,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.rejectJoinRequest(id, user.id, requesterId);
  }

  @Post(':id/decline')
  async declineCrewInvitation(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.declineCrewInvitation(id, user.id);
  }

  @Post(':id/cancel')
  async cancelCrewActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.cancelCrewActivity(id, user.id);
  }

  @Post(':id/end')
  async endCrewActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.cancelCrewActivity(id, user.id);
  }

  @Post(':id/invite')
  async inviteFriends(
    @Param('id') id: string,
    @Body('userIds') userIds: string[],
    @CurrentUser() user: any
  ) {
    return this.activitiesService.inviteFriends(id, user.id, userIds);
  }

  @Get(':id/invitations/status')
  async getInvitationStatuses(
    @Param('id') id: string,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.getInvitationStatuses(id, user.id);
  }
}

import {
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Delete,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import { CreateActivityDto } from './dto/activity.dto';
import {
  InviteFriendsDto,
  UpdateActivityVisibilityDto,
} from './dto/invite-friends.dto';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { CacheControl } from '../common/decorators/cache-control.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { PageLimitPipe } from '../common/pagination';

@Controller('api/activities')
@UseGuards(JwtGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  // @CacheControl removed: browser caching cannot be invalidated and causes
  // stale data when navigating back after joining. Relies on backend Redis cache.
  async getAllActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new PageLimitPipe({ default: 20, max: 50 })) limit: number,
    @Query('cursor') cursor?: string,
    @Query('scope') scope?: string,
  ) {
    const allowedScopes = [
      'public',
      'college',
      'campus',
      'one_on_one',
      'for_you',
    ] as const;
    const parsedScope = (allowedScopes as readonly string[]).includes(
      scope || '',
    )
      ? (scope as 'public' | 'college' | 'campus' | 'one_on_one' | 'for_you')
      : 'public';

    // The personalized feed is ordered by relevance rather than recency, so it
    // has its own ranked-offset pagination instead of the createdAt cursor.
    if (parsedScope === 'for_you') {
      return this.activitiesService.getForYouFeed(user.id, limit, cursor);
    }
    return this.activitiesService.getAllActivities(
      user?.id,
      limit,
      cursor,
      parsedScope,
    );
  }

  @Get('discover')
  async getCrewDiscover(@CurrentUser() user: AuthenticatedUser) {
    return this.activitiesService.getCrewDiscover(user.id);
  }

  @Get('me')
  // @CacheControl removed
  async getMyActivities(@CurrentUser() user: AuthenticatedUser) {
    return this.activitiesService.getMyActivities(user.id);
  }

  @Get('bookmarks')
  // @CacheControl removed
  async getSavedActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new PageLimitPipe({ default: 20, max: 50 })) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.activitiesService.getSavedActivities(user.id, limit, cursor);
  }

  @Get('bookmarks/ids')
  async getSavedActivityIds(@CurrentUser() user: AuthenticatedUser) {
    return this.activitiesService.getSavedActivityIds(user.id);
  }

  @Get('invitations/me')
  async getPendingInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.activitiesService.getPendingInvitations(user.id);
  }

  @Post('invitations/:invitationId/accept')
  async acceptInvitation(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.acceptInvitation(invitationId, user.id);
  }

  @Post('invitations/:invitationId/decline')
  async declineInvitation(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.declineInvitation(invitationId, user.id);
  }

  @Post(':id/bookmark')
  async bookmarkActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.bookmarkActivity(id, user.id);
  }

  @Delete(':id/bookmark')
  async unbookmarkActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.unbookmarkActivity(id, user.id);
  }

  /**
   * Attendees beyond the first page embedded in the detail payload.
   * Cursor-paginated so a large activity never ships one huge list.
   */
  @Get(':id/attendees')
  @CacheControl('no-store')
  async getAttendees(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new PageLimitPipe({ default: 30, max: 60 })) limit: number,
    @Query('cursor') cursor?: string,
    // `not_going` pages the "Not going" list; anything else is the attendees.
    @Query('status') status?: string,
  ) {
    return this.activitiesService.getAttendees(
      id,
      user.id,
      limit,
      cursor,
      status === 'not_going' ? 'not_going' : 'going',
    );
  }

  @Get(':id')
  @CacheControl('no-store')
  async getActivityById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.getActivityById(id, user?.id);
  }

  @Post()
  @Idempotent()
  @VerifiedOnly()
  async createActivity(
    @Body() data: CreateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.createActivity(data, user.id);
  }

  /**
   * Host-only visibility change. Takes effect immediately for every surface —
   * see ActivitiesService.updateActivityVisibility.
   */
  @Patch(':id/visibility')
  async updateVisibility(
    @Param('id') id: string,
    @Body() dto: UpdateActivityVisibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.updateActivityVisibility(
      id,
      user.id,
      dto.visibility,
    );
  }

  @Post(':id/join')
  async joinActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.joinActivity(id, user.id);
  }

  @Post(':id/leave')
  async leaveActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.leaveActivity(id, user.id);
  }

  /**
   * "I'm out": the caller is not going. Leaves the activity if they were in,
   * and declines their invitation if they hold one. "I'm in" is `:id/join`.
   */
  @Post(':id/decline')
  async declineCrewInvitation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.markNotGoing(id, user.id);
  }

  @Post(':id/cancel')
  async cancelCrewActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.cancelCrewActivity(id, user.id);
  }

  @Post(':id/end')
  async endCrewActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.endCrewActivity(id, user.id);
  }

  /**
   * Budgeted per host, not per invitee: the array is capped in the DTO, so a
   * request is at most MAX_INVITEES_PER_REQUEST notifications, and this limits
   * how many of those a host can send in an hour. The class guard has already
   * authenticated the caller, which a user-keyed policy needs.
   */
  @Post(':id/invite')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('activity.invite.user')
  async inviteFriends(
    @Param('id') id: string,
    @Body() dto: InviteFriendsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.inviteFriends(id, user.id, dto.userIds);
  }

  /** Host-only: withdraw an outstanding invitation. Effective immediately. */
  @Delete(':id/invitations/:userId')
  async revokeInvitation(
    @Param('id') id: string,
    @Param('userId') inviteeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.revokeInvitation(id, user.id, inviteeId);
  }

  @Get(':id/invitations/status')
  async getInvitationStatuses(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activitiesService.getInvitationStatuses(id, user.id);
  }
}

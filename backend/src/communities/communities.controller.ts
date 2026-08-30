import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UseGuards,
  Patch,
  Delete,
  Query,
  ParseUUIDPipe,
  Logger,
} from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VerifiedOnly } from '../common/decorators/verified-only.decorator';
import {
  CreateCommunityDto,
  UpdateCommunityDto,
  UpdateMemberRoleDto,
} from './dto/community.dto';
import { moderatorPermissions } from './moderator-permissions';

@Controller('api/communities')
@UseGuards(JwtGuard)
export class CommunitiesController {
  private readonly logger = new Logger('CommunitiesController');

  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  async getAllCommunities(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const t0 = performance.now();
    const limitNum = limit ? parseInt(limit, 10) : 30;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    const result = await this.communitiesService.getAllCommunities(
      user?.id,
      limitNum,
      offsetNum,
    );
    this.logger.debug(
      `GET /communities [limit=${limitNum} offset=${offsetNum}] ${Math.round(performance.now() - t0)}ms`,
    );
    return result;
  }

  @Get('campus')
  async getCampusCommunities(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
  ) {
    const t0 = performance.now();
    const limitNum = limit ? parseInt(limit, 10) : 30;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    const result = await this.communitiesService.getCampusCommunities(
      user?.id,
      limitNum,
      offsetNum,
      search,
    );
    this.logger.debug(
      `GET /communities/campus [userId=${user?.id}] ${Math.round(performance.now() - t0)}ms`,
    );
    return result;
  }

  /**
   * The moderator permission set, for the promotion modals.
   *
   * Served from the same table the services enforce with, so the list an owner
   * confirms against and the list a new moderator is shown are the list that
   * is actually applied. Declared above the `:id` routes because it is a
   * static path — Nest matches in declaration order, and `:id` would otherwise
   * swallow it and try to parse "moderator-permissions" as a UUID.
   */
  @Get('moderator-permissions')
  getModeratorPermissions() {
    return { permissions: moderatorPermissions() };
  }

  @Get(':id')
  async getCommunityById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    const t0 = performance.now();
    const result = await this.communitiesService.getCommunityById(id, user?.id);
    this.logger.debug(
      `GET /communities/${id} ${Math.round(performance.now() - t0)}ms`,
    );
    return result;
  }

  @Post(':id/join')
  @VerifiedOnly()
  async joinCommunity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.joinCommunity(id, user.id);
  }

  @Post(':id/leave')
  async leaveCommunity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.leaveCommunity(id, user.id);
  }

  @Get(':id/requests')
  async getPendingRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.getPendingRequests(id, user.id);
  }

  @Post(':id/requests/:requestId/accept')
  @VerifiedOnly()
  async acceptJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.acceptJoinRequest(id, requestId, user.id);
  }

  @Post(':id/requests/:requestId/decline')
  @VerifiedOnly()
  async declineJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.declineJoinRequest(id, requestId, user.id);
  }

  @Post()
  @VerifiedOnly()
  async createCommunity(
    @Body() data: CreateCommunityDto,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.createCommunity(data, user.id);
  }

  @Patch(':id')
  @VerifiedOnly()
  async updateCommunity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateCommunityDto,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.updateCommunity(id, data, user.id);
  }

  /** The pending "you're now a moderator" notice for this viewer, or null. */
  @Get(':id/moderator-notice')
  async getModeratorNotice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return {
      notice: await this.communitiesService.getModeratorNotice(id, user.id),
    };
  }

  @Post(':id/moderator-notice/ack')
  async acknowledgeModeratorNotice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.acknowledgeModeratorNotice(id, user.id);
  }

  @Patch(':id/members/:userId/role')
  @VerifiedOnly()
  async updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Body() data: UpdateMemberRoleDto,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.updateMemberRole(
      id,
      memberId,
      data.role,
      user.id,
    );
  }

  @Delete(':id/members/:userId')
  @VerifiedOnly()
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.removeMember(id, memberId, user.id);
  }

  @Delete(':id')
  @VerifiedOnly()
  async deleteCommunity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.deleteCommunity(id, user.id);
  }
}

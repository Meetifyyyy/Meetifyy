import { Controller, Get, Param, Post, Body, UseGuards, Patch, Delete, Query, ParseUUIDPipe, Logger } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateCommunityDto, UpdateCommunityDto, UpdateMemberRoleDto } from './dto/community.dto';

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
    const result = await this.communitiesService.getAllCommunities(user?.id, limitNum, offsetNum);
    this.logger.debug(`GET /communities [limit=${limitNum} offset=${offsetNum}] ${Math.round(performance.now() - t0)}ms`);
    return result;
  }

  @Get('campus')
  async getCampusCommunities(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const t0 = performance.now();
    const limitNum = limit ? parseInt(limit, 10) : 30;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    const result = await this.communitiesService.getCampusCommunities(user?.id, limitNum, offsetNum);
    this.logger.debug(`GET /communities/campus [userId=${user?.id}] ${Math.round(performance.now() - t0)}ms`);
    return result;
  }

  @Get(':id')
  async getCommunityById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const t0 = performance.now();
    const result = await this.communitiesService.getCommunityById(id, user?.id);
    this.logger.debug(`GET /communities/${id} ${Math.round(performance.now() - t0)}ms`);
    return result;
  }

  @Post(':id/join')
  async joinCommunity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.communitiesService.joinCommunity(id, user.id);
  }

  @Post(':id/leave')
  async leaveCommunity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.communitiesService.leaveCommunity(id, user.id);
  }

  @Get(':id/requests')
  async getPendingRequests(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.communitiesService.getPendingRequests(id, user.id);
  }

  @Post(':id/requests/:requestId/accept')
  async acceptJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.acceptJoinRequest(id, requestId, user.id);
  }

  @Post(':id/requests/:requestId/decline')
  async declineJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.declineJoinRequest(id, requestId, user.id);
  }

  @Post()
  async createCommunity(@Body() data: CreateCommunityDto, @CurrentUser() user: any) {
    return this.communitiesService.createCommunity(data, user.id);
  }

  @Patch(':id')
  async updateCommunity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateCommunityDto,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.updateCommunity(id, data, user.id);
  }

  @Patch(':id/members/:userId/role')
  async updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Body() data: UpdateMemberRoleDto,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.updateMemberRole(id, memberId, data.role, user.id);
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: any,
  ) {
    return this.communitiesService.removeMember(id, memberId, user.id);
  }

  @Delete(':id')
  async deleteCommunity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.communitiesService.deleteCommunity(id, user.id);
  }
}

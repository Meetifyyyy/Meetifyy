import { Controller, Get, Param, Post, Body, UseGuards, Patch, Delete, Query } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateCommunityDto, UpdateCommunityDto } from './dto/community.dto';

@Controller('api/communities')
@UseGuards(JwtGuard)
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  async getAllCommunities(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 30;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.communitiesService.getAllCommunities(user?.id, limitNum, offsetNum);
  }

  @Get(':id')
  async getCommunityById(@Param('id') id: string, @CurrentUser() user: any) {
    return this.communitiesService.getCommunityById(id, user?.id);
  }

  @Post(':id/join')
  async joinCommunity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.communitiesService.joinCommunity(id, user.id);
  }

  @Post(':id/leave')
  async leaveCommunity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.communitiesService.leaveCommunity(id, user.id);
  }

  @Post()
  async createCommunity(@Body() data: CreateCommunityDto, @CurrentUser() user: any) {
    return this.communitiesService.createCommunity(data, user.id);
  }

  @Patch(':id')
  async updateCommunity(@Param('id') id: string, @Body() data: UpdateCommunityDto, @CurrentUser() user: any) {
    return this.communitiesService.updateCommunity(id, data, user.id);
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') memberId: string, @CurrentUser() user: any) {
    return this.communitiesService.removeMember(id, memberId, user.id);
  }

  @Delete(':id')
  async deleteCommunity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.communitiesService.deleteCommunity(id, user.id);
  }
}

import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CacheControl } from '../common/decorators/cache-control.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(JwtGuard)
  @CacheControl('private, max-age=60, stale-while-revalidate=300')
  async getAllUsers(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getAllUsers(limitNum, offsetNum);
  }

  @Get('connections')
  @UseGuards(JwtGuard)
  @CacheControl('private, max-age=30, stale-while-revalidate=120')
  async getConnections(@Req() req: any, @Query('q') query?: string, @Query('limit') limit?: string) {
    const limitNum = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    return this.usersService.getConnections(req.user.id, query, limitNum);
  }

  @Get('campus')
  @UseGuards(JwtGuard)
  @CacheControl('private, max-age=600, stale-while-revalidate=1800')
  async getCampusUsers(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getCampusUsers(req.user.id, limitNum, offsetNum);
  }

  @Get('id/:id')
  @UseGuards(JwtGuard)
  @CacheControl('private, max-age=120, stale-while-revalidate=600')
  async getUserById(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  @Patch('me')
  @UseGuards(JwtGuard)
  async updateProfile(@Req() req: any, @Body() data: any) {
    const currentUserId = req.user?.id;
    const userEmail = req.user?.email || req.user?.user_metadata?.email;
    return this.usersService.updateProfile(currentUserId, data, userEmail);
  }

  @Get('me/settings')
  @UseGuards(JwtGuard)
  async getSettings(@Req() req: any) {
    return this.usersService.getSettings(req.user.id);
  }

  @Patch('me/settings')
  @UseGuards(JwtGuard)
  async updateSettings(@Req() req: any, @Body() data: any) {
    return this.usersService.updateSettings(req.user.id, data);
  }

  @Get(':username')
  @UseGuards(JwtGuard)
  @CacheControl('private, max-age=120, stale-while-revalidate=600')
  async getProfile(@Param('username') username: string, @Req() req: any) {
    const currentUserId = req.user?.id; 
    return this.usersService.getProfileByUsername(username, currentUserId);
  }

  @Get(':username/followers')
  @UseGuards(JwtGuard)
  @CacheControl('private, max-age=60, stale-while-revalidate=300')
  async getFollowers(
    @Param('username') username: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getFollowers(username, req.user?.id, limitNum, offsetNum);
  }

  @Get(':username/following')
  @UseGuards(JwtGuard)
  @CacheControl('private, max-age=60, stale-while-revalidate=300')
  async getFollowing(
    @Param('username') username: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.usersService.getFollowing(username, req.user?.id, limitNum, offsetNum);
  }

  @Post(':username/follow')
  @UseGuards(JwtGuard)
  async follow(@Param('username') username: string, @Req() req: any) {
    const currentUserId = req.user?.id;
    return this.usersService.followUser(currentUserId, username);
  }

  @Post(':username/unfollow')
  @UseGuards(JwtGuard)
  async unfollow(@Param('username') username: string, @Req() req: any) {
    const currentUserId = req.user?.id;
    return this.usersService.unfollowUser(currentUserId, username);
  }

  @Post('block/:targetUserId')
  @UseGuards(JwtGuard)
  async blockUser(@Param('targetUserId') targetUserId: string, @Req() req: any) {
    return this.usersService.blockUser(req.user.id, targetUserId);
  }

  @Delete('block/:targetUserId')
  @UseGuards(JwtGuard)
  async unblockUser(@Param('targetUserId') targetUserId: string, @Req() req: any) {
    return this.usersService.unblockUser(req.user.id, targetUserId);
  }
}

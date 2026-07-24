import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

@UseGuards(AdminJwtGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  async listUsers(
    @Query('search') search?: string,
    @Query('accountStatus') accountStatus?: string,
    @Query('collegeId') collegeId?: string,
    @Query('emailVerified') emailVerified?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.listUsers({
      search,
      accountStatus,
      collegeId,
      emailVerified: emailVerified !== undefined ? emailVerified === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  @Post(':id/suspend')
  async suspendUser(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.usersService.suspendUser(id, reason);
  }

  @Post(':id/unsuspend')
  async unsuspendUser(@Param('id') id: string) {
    return this.usersService.unsuspendUser(id);
  }

  @Delete(':id')
  async softDeleteUser(@Param('id') id: string) {
    return this.usersService.softDeleteUser(id);
  }

  @Post(':id/restore')
  async restoreUser(@Param('id') id: string) {
    return this.usersService.restoreUser(id);
  }

  @Post(':id/verify-email')
  async verifyEmail(@Param('id') id: string) {
    return this.usersService.verifyEmailManually(id);
  }

  @Post(':id/reset-college')
  async resetCollege(@Param('id') id: string) {
    return this.usersService.resetCollegeVerification(id);
  }

  @Patch(':id/capabilities')
  async updateCapabilities(
    @Param('id') id: string,
    @Body() capabilities: { canPost?: boolean; canMessage?: boolean; canActivity?: boolean },
  ) {
    return this.usersService.updateCapabilities(id, capabilities);
  }

  @Post(':id/force-logout')
  async forceLogout(@Param('id') id: string) {
    return this.usersService.forceLogout(id);
  }
}

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
import { RevokeAffiliationDto } from '../../campus-affiliation/dto/campus-affiliation.dto';
import { SetCampusRepDto, SuspendUserDto } from './dto/admin-users.dto';
import { PageLimitPipe, PageNumberPipe } from '../../common/pagination';

@UseGuards(AdminJwtGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  async listUsers(
    @Query('search') search?: string,
    @Query('accountStatus') accountStatus?: string,
    @Query('collegeId') collegeId?: string,
    @Query('page', new PageNumberPipe({ max: 1000 })) page?: number,
    @Query('limit', new PageLimitPipe({ default: 20, max: 100 }))
    limit?: number,
  ) {
    return this.usersService.listUsers({
      search,
      accountStatus,
      collegeId,
      page,
      limit,
    });
  }

  // Static routes MUST precede `:id` so they aren't captured as an id.
  @Get('campus-reps')
  async listCampusReps(@Query('collegeId') collegeId?: string) {
    return this.usersService.listCampusReps(collegeId);
  }

  @Get('rep-candidates')
  async searchRepCandidates(
    @Query('search') search?: string,
    @Query('collegeId') collegeId?: string,
  ) {
    return this.usersService.searchRepCandidates(search, collegeId);
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  @Post(':id/campus-rep')
  async setCampusRep(@Param('id') id: string, @Body() dto: SetCampusRepDto) {
    return this.usersService.setCampusRep(id, dto.isCampusRep);
  }

  @Post(':id/suspend')
  async suspendUser(@Param('id') id: string, @Body() dto: SuspendUserDto) {
    return this.usersService.suspendUser(id, dto.reason);
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

  @Post(':id/reset-college')
  async resetCollege(@Param('id') id: string) {
    return this.usersService.resetCollegeVerification(id);
  }

  /**
   * Ends a user's campus access. The address stays reserved (audit) until the
   * affiliation is deleted via reset-college.
   */
  @Patch(':id/college-affiliation/revoke')
  async revokeCollegeAffiliation(
    @Param('id') id: string,
    @Body() dto: RevokeAffiliationDto,
  ) {
    return this.usersService.revokeCollegeAffiliation(id, dto.reason);
  }

  @Post(':id/force-logout')
  async forceLogout(@Param('id') id: string) {
    return this.usersService.forceLogout(id);
  }
}

import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateActivityDto } from './dto/activity.dto';

@Controller('api/activities')
@UseGuards(JwtGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  async getAllActivities(@CurrentUser() user: any) {
    return this.activitiesService.getAllActivities(user?.id);
  }

  @Get(':id')
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

  @Post(':id/end')
  async endCrewActivity(@Param('id') id: string, @CurrentUser() user: any) {
    return this.activitiesService.endCrewActivity(id, user.id);
  }
}

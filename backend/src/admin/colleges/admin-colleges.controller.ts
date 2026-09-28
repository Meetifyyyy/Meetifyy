import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminCollegesService } from './admin-colleges.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import {
  ChangeCollegeStatusDto,
  CreateCollegeDto,
  UpdateCollegeDto,
} from './dto/college.dto';

@UseGuards(AdminJwtGuard)
@Controller('admin/colleges')
export class AdminCollegesController {
  constructor(private readonly collegesService: AdminCollegesService) {}

  @Get()
  async listColleges(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.collegesService.listColleges({
      search,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  async getCollege(@Param('id') id: string) {
    return this.collegesService.getCollegeById(id);
  }

  @Post()
  async createCollege(@Body() dto: CreateCollegeDto) {
    return this.collegesService.createCollege(dto);
  }

  @Patch(':id')
  async updateCollege(@Param('id') id: string, @Body() dto: UpdateCollegeDto) {
    return this.collegesService.updateCollege(id, dto);
  }

  @Patch(':id/status')
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeCollegeStatusDto,
  ) {
    return this.collegesService.changeStatus(id, dto.status);
  }

  @Patch(':id/restore')
  async restoreCollege(@Param('id') id: string) {
    return this.collegesService.restoreCollege(id);
  }

  @Post(':id/domains')
  async addDomain(
    @Param('id') id: string,
    @Body('domain') domain: string,
    @Body('isPrimary') isPrimary?: boolean,
  ) {
    return this.collegesService.addDomain(id, domain, isPrimary);
  }

  @Patch(':id/domains/:domainId/status')
  async toggleDomainStatus(
    @Param('id') id: string,
    @Param('domainId') domainId: string,
    @Body('status') status: 'ACTIVE' | 'DISABLED',
  ) {
    return this.collegesService.toggleDomainStatus(id, domainId, status);
  }

  @Delete(':id/domains/:domainId')
  async removeDomain(
    @Param('id') id: string,
    @Param('domainId') domainId: string,
  ) {
    return this.collegesService.removeDomain(id, domainId);
  }

  @Delete(':id')
  async deleteCollege(@Param('id') id: string) {
    return this.collegesService.softDeleteCollege(id);
  }

  @Get('requests/list')
  async listCollegeRequests(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.collegesService.listCollegeRequests({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch('requests/:requestId/status')
  async updateCollegeRequestStatus(
    @Param('requestId') requestId: string,
    @Body('status') status: string,
  ) {
    return this.collegesService.updateCollegeRequestStatus(requestId, status);
  }
}

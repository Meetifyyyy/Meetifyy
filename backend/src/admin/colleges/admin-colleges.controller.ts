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
  async createCollege(@Body() dto: {
    name: string;
    shortName?: string;
    slug?: string;
    domains: string[];
    city?: string;
    state?: string;
    country?: string;
    logoKey?: string;
    bannerKey?: string;
    isPrivate?: boolean;
  }) {
    return this.collegesService.createCollege(dto);
  }

  @Patch(':id')
  async updateCollege(
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.collegesService.updateCollege(id, dto);
  }

  @Patch(':id/status')
  async changeStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.collegesService.changeStatus(id, status);
  }

  @Post(':id/domains')
  async addDomain(
    @Param('id') id: string,
    @Body('domain') domain: string,
    @Body('isPrimary') isPrimary?: boolean,
  ) {
    return this.collegesService.addDomain(id, domain, isPrimary);
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
}

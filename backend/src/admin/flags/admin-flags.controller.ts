import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminFlagsService } from './admin-flags.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

@UseGuards(AdminJwtGuard)
@Controller('admin/flags')
export class AdminFlagsController {
  constructor(private readonly flagsService: AdminFlagsService) {}

  @Get()
  async listFlags() {
    return this.flagsService.listFlags();
  }

  @Post()
  async upsertFlag(
    @Body() dto: {
      key: string;
      enabled: boolean;
      description?: string;
      rolloutPercentage?: number;
    },
  ) {
    return this.flagsService.upsertFlag(dto);
  }

  @Delete(':key')
  async deleteFlag(@Param('key') key: string) {
    return this.flagsService.deleteFlag(key);
  }
}

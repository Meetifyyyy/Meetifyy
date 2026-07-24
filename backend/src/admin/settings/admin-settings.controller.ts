import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AdminSettingsService } from './admin-settings.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

@UseGuards(AdminJwtGuard)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settingsService: AdminSettingsService) {}

  @Get()
  async listSettings() {
    return this.settingsService.listSettings();
  }

  @Post()
  async upsertSetting(
    @Body() dto: {
      key: string;
      value: string;
      type?: string;
      description?: string;
    },
  ) {
    return this.settingsService.upsertSetting(dto);
  }
}

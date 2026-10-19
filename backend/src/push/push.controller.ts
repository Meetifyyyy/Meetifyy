import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { currentSessionId } from '../auth/session/current-session-id';
import {
  PushDevicesService,
  PushPreferencesView,
} from './push-devices.service';
import {
  RegisterPushDeviceDto,
  UnregisterPushDeviceDto,
  UpdatePushPreferencesDto,
} from './dto/register-push-device.dto';

/**
 * Push registration and preferences. Additive: no installed build calls these
 * until it ships with push, and none of them changes an existing route.
 *
 * Every route acts on the authenticated caller only. There is no user id in
 * any body or path, so nothing here can touch another account's devices.
 */
@Controller('api/push')
@UseGuards(JwtGuard)
export class PushController {
  constructor(private readonly devices: PushDevicesService) {}

  @Get('config')
  getConfig() {
    return this.devices.clientConfig();
  }

  @Put('devices')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('push.register')
  async register(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterPushDeviceDto,
  ): Promise<{ registered: true }> {
    return this.devices.register(req.user.id, currentSessionId(req), dto);
  }

  /** POST rather than DELETE-with-body, which some proxies strip. */
  @Post('devices/unregister')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('push.register')
  async unregister(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UnregisterPushDeviceDto,
  ): Promise<{ removed: boolean }> {
    return this.devices.unregister(req.user.id, dto.token);
  }

  @Get('preferences')
  async getPreferences(
    @Req() req: AuthenticatedRequest,
  ): Promise<PushPreferencesView> {
    return this.devices.getPreferences(req.user.id);
  }

  @Patch('preferences')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('push.preferences')
  async updatePreferences(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdatePushPreferencesDto,
  ): Promise<PushPreferencesView> {
    return this.devices.updatePreferences(req.user.id, dto);
  }
}

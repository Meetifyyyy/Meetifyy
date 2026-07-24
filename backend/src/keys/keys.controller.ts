import { Controller, Post, Get, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { KeysService } from './keys.service';
import { JwtGuard } from '../common/guards/jwt.guard';

@Controller('api/keys')
export class KeysController {
  constructor(private readonly keysService: KeysService) {}

  @Post('register')
  @UseGuards(JwtGuard)
  async registerDevice(@Req() req: any, @Body() data: any) {
    const userId = req.user?.id;
    return this.keysService.registerDevice(userId, data);
  }

  @Get('bundle/:targetUserId')
  @UseGuards(JwtGuard)
  async getBundle(@Param('targetUserId') targetUserId: string) {
    return this.keysService.fetchPreKeyBundle(targetUserId);
  }

  @Get('status')
  @UseGuards(JwtGuard)
  async getStatus(@Req() req: any, @Query('deviceId') deviceIdQuery?: string) {
    const userId = req.user?.id;
    const deviceId = req.headers['x-device-id'] || deviceIdQuery;
    return this.keysService.getOpkStatus(userId, deviceId);
  }

  @Post('replenish')
  @UseGuards(JwtGuard)
  async replenish(@Req() req: any, @Body() data: any, @Query('deviceId') deviceIdQuery?: string) {
    const userId = req.user?.id;
    const deviceId = req.headers['x-device-id'] || data?.deviceId || deviceIdQuery;
    return this.keysService.replenishOpks(userId, deviceId, data?.oneTimePreKeys);
  }

  @Post('rotate-spk')
  @UseGuards(JwtGuard)
  async rotateSpk(@Req() req: any, @Body() data: any, @Query('deviceId') deviceIdQuery?: string) {
    const userId = req.user?.id;
    const deviceId = req.headers['x-device-id'] || data?.deviceId || deviceIdQuery;
    return this.keysService.rotateSpk(userId, deviceId, data);
  }
}

import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminLoginDto,
  VerifyOtpDto,
  VerifyTotpDto,
} from './dto/admin-auth.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import * as crypto from 'crypto';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const isProd = process.env.NODE_ENV === 'production';
    const csrfToken = crypto.randomBytes(32).toString('hex');

    res.cookie('admin_access', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 mins
      path: '/',
    });

    res.cookie('admin_refresh', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/',
    });

    res.cookie('admin_csrf', csrfToken, {
      httpOnly: false, // exposed to frontend JS to attach as X-CSRF-Token header
      secure: isProd,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
  }

  private clearAuthCookies(res: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie('admin_access', { path: '/', httpOnly: true, secure: isProd, sameSite: 'strict' });
    res.clearCookie('admin_refresh', { path: '/', httpOnly: true, secure: isProd, sameSite: 'strict' });
    res.clearCookie('admin_csrf', { path: '/', sameSite: 'strict' });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Req() req: any) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    return this.authService.login(dto, ip, userAgent);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result = await this.authService.verifyOtp(dto, ip, userAgent);

    if ('accessToken' in result) {
      this.setAuthCookies(res, result.accessToken, result.refreshToken);
      return { success: true, admin: result.admin };
    }

    return result;
  }

  @Post('verify-totp')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @Body() dto: VerifyTotpDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result = await this.authService.verifyTotp(dto, ip, userAgent);

    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { success: true, admin: result.admin };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const refreshToken = req.cookies?.admin_refresh || req.body?.refreshToken;
    if (!refreshToken) {
      this.clearAuthCookies(res);
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Refresh token missing' });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    try {
      const result = await this.authService.refreshTokens(refreshToken, ip, userAgent);
      this.setAuthCookies(res, result.accessToken, result.refreshToken);
      return { success: true };
    } catch (err) {
      this.clearAuthCookies(res);
      throw err;
    }
  }

  @UseGuards(AdminJwtGuard)
  @Get('me')
  async getProfile(@Req() req: any) {
    return { success: true, admin: req.admin };
  }

  @UseGuards(AdminJwtGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    if (req.adminSession?.id) {
      await this.authService.logout(req.adminSession.id);
    }
    this.clearAuthCookies(res);
    return { success: true, message: 'Logged out' };
  }

  @UseGuards(AdminJwtGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.authService.logoutAll(req.admin.id);
    this.clearAuthCookies(res);
    return { success: true, message: 'Logged out from all devices' };
  }

  @UseGuards(AdminJwtGuard)
  @Get('sessions')
  async listSessions(@Req() req: any) {
    return this.authService.listSessions(req.admin.id);
  }

  @UseGuards(AdminJwtGuard)
  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Req() req: any, @Param('id') id: string) {
    return this.authService.revokeSession(req.admin.id, id);
  }
}

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Check API Key header for external Super Admin microservices/webapps
    const superAdminApiKey = this.configService.get<string>('SUPER_ADMIN_API_KEY');
    const requestApiKey = request.headers['x-super-admin-api-key'] || request.headers['x-admin-secret'];

    if (superAdminApiKey && requestApiKey && requestApiKey === superAdminApiKey) {
      request.adminAuthType = 'API_KEY';
      return true;
    }

    // 2. Fall back to JWT user role check
    const user = request.user;
    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required');
    }

    // Fetch user from DB to verify current role
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, accountStatus: true },
    });

    if (!dbUser) {
      throw new UnauthorizedException('User not found');
    }

    if (dbUser.accountStatus === 'BANNED' || dbUser.accountStatus === 'SUSPENDED') {
      throw new ForbiddenException('Account suspended');
    }

    const isAuthorizedRole = dbUser.role === 'ADMIN' || dbUser.role === 'SUPER_ADMIN' || dbUser.role === 'MODERATOR';
    if (!isAuthorizedRole) {
      throw new ForbiddenException('Super Admin or Moderator privilege required');
    }

    request.dbUser = dbUser;
    request.adminAuthType = 'JWT_ROLE';
    return true;
  }
}

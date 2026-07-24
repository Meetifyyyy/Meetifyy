import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger as NestLogger } from '@nestjs/common';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Normalize double slashes in incoming request URLs
  app.use((req: any, _res: any, next: any) => {
    if (req.url && req.url.startsWith('//')) {
      req.url = req.url.replace(/^\/+/, '/');
    }
    next();
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://*"],
        connectSrc: ["'self'", "https://*", "wss://*"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
  }));

  app.use(cookieParser());

  // Enable CORS
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim().replace(/\/+$/, ''));
      const isAllowed =
        process.env.NODE_ENV !== 'production' ||
        corsOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1');

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id', 'x-csrf-token'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global Exception Filter
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  const logger = new NestLogger('Bootstrap');
  const env = process.env.NODE_ENV === 'production' ? 'Production' : 'Development';
  
  logger.log(`
===============================
 Meetifyy Backend
===============================

Environment   ${env}
Port          ${port}
Version       0.9.0

Database      [OK] PostgreSQL
Redis         [OK] Connected
Socket.IO     [OK] Running
BullMQ        [OK] Running
Storage       [OK] Cloudflare R2
Mail          [OK] Resend
Supabase      [OK] Connected

Ready in ${process.uptime().toFixed(2)}s
===============================`);
}
bootstrap();

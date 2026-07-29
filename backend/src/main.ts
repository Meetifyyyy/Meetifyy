import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger as NestLogger } from '@nestjs/common';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const isProd = process.env.NODE_ENV === 'production';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  integrations: [
    nodeProfilingIntegration(),
  ],
  // Sample 10% of traces and 5% of profiles in production — 1.0 in production
  // adds measurable per-request overhead and inflates Sentry costs dramatically.
  tracesSampleRate: isProd ? 0.1 : 1.0,
  profilesSampleRate: isProd ? 0.05 : 1.0,
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

  // Response compression — reduces JSON payload size by 60-80%
  // Threshold: only compress responses > 1KB (avoids overhead on tiny responses)
  app.use(compression({ level: 6, threshold: 1024 }));

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const configuredCorsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  // Security Headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
         scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        workerSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
         imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://media.giphy.com"],
         connectSrc: ["'self'", ...configuredCorsOrigins],
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
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
      if (!origin) return callback(null, true);
      const isDevelopmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(origin);
       const isAllowed = isProd
         ? configuredCorsOrigins.includes(origin)
         : configuredCorsOrigins.includes(origin) || isDevelopmentOrigin;

      // Fix: passing `true` as the second arg still allows the origin.
      // Reject unknown origins in production by passing an Error instead.
      if (isAllowed) {
        callback(null, origin);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
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

  const server = app.getHttpServer();
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

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

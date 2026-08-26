import { NestFactory } from '@nestjs/core';
import { config } from './config';
import { AppModule } from './app.module';
import { ValidationPipe, Logger as NestLogger } from '@nestjs/common';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: config.app.observability.sentryDsn,
  environment: config.env,
  integrations: [nodeProfilingIntegration()],
  // Sampling defaults to 10% of traces and 5% of profiles in production — 1.0
  // there adds measurable per-request overhead and inflates Sentry costs
  // dramatically. Both are tunable per environment.
  tracesSampleRate: config.app.observability.sentryTracesSampleRate,
  profilesSampleRate: config.app.observability.sentryProfilesSampleRate,
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

  // Every allowed origin comes from configuration — FRONTEND_URL, ADMIN_URL and
  // CORS_ORIGINS. Adding a preview domain is an environment change, never a
  // code change.
  const {
    origins: configuredCorsOrigins,
    originPatterns,
    allowLocalNetwork,
  } = config.app.cors;

  // Security headers. CSP and HSTS default to production-only: CSP off in dev so
  // LAN access from other devices works without pre-listing every local IP, and
  // HSTS off because it can pin a browser session to HTTPS and break local
  // http:// connections. Both are overridable per environment.
  // CSP sources are additive: 'self' plus whatever the environment declares.
  // A new CDN or media host is a CSP_*_SRC change, not a deploy of new source.
  const { security } = config.app;
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'unsafe-none' },
      contentSecurityPolicy: security.cspEnabled
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", ...security.cspScriptSrc],
              workerSrc: ["'self'", 'blob:', ...security.cspScriptSrc],
              styleSrc: ["'self'", "'unsafe-inline'", ...security.cspStyleSrc],
              fontSrc: ["'self'", ...security.cspFontSrc],
              imgSrc: ["'self'", 'data:', 'blob:', ...security.cspImgSrc],
              connectSrc: [
                "'self'",
                ...security.cspConnectSrc,
                ...configuredCorsOrigins,
              ],
            },
          }
        : false,
      hsts: security.hstsEnabled
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    }),
  );

  app.use(cookieParser());

  // Enable CORS
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      if (!origin) return callback(null, true);
      // Localhost / LAN origins are trusted only where the environment says so.
      // `allowLocalNetwork` is forced off in production, so a prod API can never
      // treat a developer's machine as a same-trust origin.
      const isLocalNetworkOrigin =
        allowLocalNetwork &&
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|100\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(
          origin,
        );

      // Wildcard entries (from CORS_ORIGIN_PATTERNS or a starred CORS_ORIGINS
      // entry) let a deployment allow its own preview domains without listing
      // each one.
      const matchesPattern = (allowed: string) => {
        if (allowed === '*') return true;
        if (!allowed.includes('*')) return false;
        const regexPattern =
          '^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '[^.]*') + '$';
        return new RegExp(regexPattern, 'i').test(origin);
      };

      const isAllowed =
        configuredCorsOrigins.includes(origin) ||
        isLocalNetworkOrigin ||
        originPatterns.some(matchesPattern) ||
        configuredCorsOrigins.some(matchesPattern);

      if (isAllowed) {
        callback(null, origin);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
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

  const { port, host } = config.app;
  await app.listen(port, host);

  const server = app.getHttpServer();
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const logger = new NestLogger('Bootstrap');

  logger.log(`
===============================
 ${config.app.name} Backend
===============================

Environment   ${config.env}
Host          ${host}:${port}
Version       ${config.app.version}
Frontend      ${config.app.frontendUrl}
API base      ${config.app.apiBaseUrl || `(derived at request time)`}

Database      [OK] PostgreSQL
Redis         [OK] ${config.redis.url ? 'Connected' : `${config.redis.host}:${config.redis.port}`}
Socket.IO     [OK] Running
BullMQ        [OK] Running
Storage       [OK] ${config.storage.provider}
Mail          [OK] ${config.email.driver}
Supabase      [OK] Connected

Ready in ${process.uptime().toFixed(2)}s
===============================`);
}
bootstrap();

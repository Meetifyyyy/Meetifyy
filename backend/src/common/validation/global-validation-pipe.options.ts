import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * The options of the app-wide ValidationPipe, in one place so the tests that
 * prove a body is refused run the pipe exactly as production does.
 *
 * `whitelist` + `forbidNonWhitelisted` is why a DTO must name every field a
 * client sends, including the ones an older installed app still includes: an
 * undeclared field is a 400, not a silent drop.
 */
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

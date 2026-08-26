import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export type TimeWindow = '1h' | '24h' | '7d';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

/**
 * Every query parameter is validated against a fixed set rather than passed
 * through. These values reach raw SQL interval expressions and Prisma filters,
 * so the allow-list is what keeps an interpolated window from becoming an
 * injection point.
 */
export class TimeseriesDto {
  @IsIn(['requests', 'errors', 'latency'])
  metric: 'requests' | 'errors' | 'latency';

  @IsOptional()
  @IsIn(['1h', '24h', '7d'])
  window?: TimeWindow;
}

export class WindowDto {
  @IsOptional()
  @IsIn(['1h', '24h', '7d'])
  window?: TimeWindow;
}

export class ListLogsDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) route?: string;

  @IsOptional() @Transform(trim) @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'get', 'post', 'put', 'patch', 'delete'])
  method?: string;

  /** A full status (404) or a class (4 meaning 4xx). */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(3) status?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) requestId?: string;

  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;

  @IsOptional() @Transform(toInt) @IsInt() @Min(1) page?: number;
}

export class ListErrorsDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) route?: string;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) page?: number;
}

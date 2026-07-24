import { IsEnum, IsString, IsOptional, MaxLength, IsObject } from 'class-validator';
import { ReportTargetType, ReportReason } from '@prisma/client';

export class SubmitReportDto {
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @IsString()
  targetId: string;

  @IsEnum(ReportReason)
  reason: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

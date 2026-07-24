import { IsArray, IsEnum, IsOptional, IsString, ArrayNotEmpty } from 'class-validator';
import { ReportStatus, ReportPriority } from '@prisma/client';

export class BulkActionReportDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  reportIds: string[];

  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsEnum(ReportPriority)
  priority?: ReportPriority;

  @IsOptional()
  @IsString()
  assignedModeratorId?: string;

  @IsOptional()
  @IsString()
  resolution?: string;
}

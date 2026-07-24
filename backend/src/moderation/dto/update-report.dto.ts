import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportStatus, ReportPriority } from '@prisma/client';

export class UpdateReportDto {
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
  @MaxLength(2000)
  internalNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  actionTaken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string;
}

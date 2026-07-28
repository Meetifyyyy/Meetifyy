import { IsString, IsOptional, IsBoolean, MaxLength, IsDateString, IsNumber } from 'class-validator';

export class CreateActivityDto {
  @IsString()
  @MaxLength(30)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  coverImage?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  location?: string;

  @IsBoolean()
  @IsOptional()
  createActivityGroup?: boolean;

  @IsBoolean()
  @IsOptional()
  shareToCampus?: boolean;

  @IsString()
  @IsOptional()
  visibility?: string;

  @IsNumber()
  @IsOptional()
  maxMembers?: number;
}

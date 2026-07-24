import { IsString, IsOptional, IsBoolean, MaxLength, IsDateString, IsNumber } from 'class-validator';

export class CreateActivityDto {
  @IsString()
  @MaxLength(100)
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
  location?: string;

  @IsBoolean()
  @IsOptional()
  createActivityGroup?: boolean;

  @IsNumber()
  @IsOptional()
  maxMembers?: number;
}

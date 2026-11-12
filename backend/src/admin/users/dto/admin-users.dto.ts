import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** `POST /admin/users/:id/campus-rep`. */
export class SetCampusRepDto {
  @IsBoolean()
  isCampusRep!: boolean;
}

/**
 * `POST /admin/users/:id/suspend`. The admin portal sends no body at all, so
 * `reason` is optional; when given it is only echoed back, never stored, and
 * 500 matches the reviewer-reason limit used elsewhere in the portal.
 */
export class SuspendUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

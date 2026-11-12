import { ArrayMaxSize, IsArray, IsIn, IsUUID } from 'class-validator';

/**
 * The most people one invite request may name.
 *
 * An invitation writes a row, raises a notification and may send a push per
 * person, so the array is the fan-out. Nothing in the product asks for more
 * than a handful at a time — the picker is a sheet of friends — and there is no
 * per-activity ceiling to borrow, because `maxMembers` is optional and
 * unbounded. 100 is far above any real selection while keeping one request,
 * and the budget in `activity.invite.user`, from fanning out to thousands.
 */
export const MAX_INVITEES_PER_REQUEST = 100;

/** `POST /api/activities/:id/invite`. */
export class InviteFriendsDto {
  @IsArray()
  @ArrayMaxSize(MAX_INVITEES_PER_REQUEST, {
    message: `You can invite at most ${MAX_INVITEES_PER_REQUEST} people at once.`,
  })
  @IsUUID('all', { each: true })
  userIds!: string[];
}

/**
 * `PATCH /api/activities/:id/visibility`. The three values are the ones
 * `ActivitiesService.updateActivityVisibility` accepts and `CreateActivityDto`
 * lists; anything else was already refused there, now before it gets that far.
 */
export class UpdateActivityVisibilityDto {
  @IsIn(['PUBLIC', 'COLLEGE_ONLY', 'PRIVATE'])
  visibility!: string;
}

import { IsString } from 'class-validator';
import { MaxChars } from '../../common/validation/max-chars.validator';

/**
 * The longest search term worth remembering. The search box itself stops at
 * 100 characters (web and the native app both), so a longer term is not
 * something a person typed.
 */
export const MAX_RECENT_SEARCH_TERM_LENGTH = 100;

/**
 * `POST /api/search/recent`. A blank term is still answered with the unchanged
 * list by the service; only a missing or non-string one is refused here.
 */
export class AddRecentSearchDto {
  @IsString()
  @MaxChars(MAX_RECENT_SEARCH_TERM_LENGTH)
  term!: string;
}

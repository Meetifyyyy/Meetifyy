/**
 * Campus tab icon — wraps HugeiconsIcon's GraduationCapIcon.
 *
 * CampusOutline → stroke variant (used when the nav item is inactive)
 * CampusSolid   → solid  variant (used when the nav item is active)
 *
 * Both are passed to <NavIcon outline={…} solid={…} />, which clones a
 * className onto whichever element it receives, so props must be spread
 * onto the underlying element. HugeiconsIcon accepts className normally.
 */
import { HugeiconsIcon } from '@hugeicons/react';
import { GraduationCapIcon } from '@hugeicons/core-free-icons';

export const CampusOutline = ({ size = 22, ...props }) => (
  <HugeiconsIcon icon={GraduationCapIcon} type="stroke" strokeWidth={1.7} size={size} {...props} />
);

export const CampusSolid = ({ size = 22, ...props }) => (
  <HugeiconsIcon icon={GraduationCapIcon} type="solid" size={size} {...props} />
);

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/** The declarations of the first rule whose selector line is exactly `selector {`. */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`rule not found: ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

// Every stylesheet rule that draws a COMMUNITY's icon. People stay circular;
// these must all follow the one shared token so the shapes cannot drift apart.
const COMMUNITY_AVATAR_RULES = [
  ['features/communities/components/directory/CommunityAvatar.module.css', '.avatar'],
  ['features/communities/components/view/CommunityView.module.css', '.heroAvatar'],
  ['features/communities/components/view/CommunityView.module.css', '.heroAvatarImg'],
  ['features/communities/components/view/CommunityView.module.css', '.avatarEditOverlay'],
  ['features/search/pages/SearchResultsRoute.module.css', '.communityIconBox'],
  ['features/feed/components/post/Post.module.css', '.communityBadgeOverlay'],
  ['features/communities/components/modals/CreateCommunityModal.module.css', '.avatarCropperContainer'],
  ['features/communities/components/modals/CreateCommunityModal.module.css', '.cropperWrapper'],
  ['features/communities/components/modals/CreateCommunityModal.module.css', '.letterAvatar'],
  ['features/communities/components/home/HomeCommunities.module.css', '.ghostAvatar'],
];

describe('community avatars are rounded squares', () => {
  it('defines the shared radius token', () => {
    expect(read('styles/variables.css')).toMatch(/--community-avatar-radius:\s*28%/);
  });

  it.each(COMMUNITY_AVATAR_RULES)('%s %s uses the shared radius', (file, selector) => {
    const body = ruleBody(read(file), selector);
    expect(body).toMatch(/border-radius:\s*(var\(--community-avatar-radius\)|inherit)/);
    expect(body).not.toMatch(/border-radius:\s*50%/);
  });
});

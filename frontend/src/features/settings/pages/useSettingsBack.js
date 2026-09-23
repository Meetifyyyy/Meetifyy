import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useSmartNavigation, canGoBackInApp } from '@shared/hooks/useSmartNavigation';

/**
 * Back and close for the Settings pages.
 *
 * @param {object}   args
 * @param {string|null} args.activePanel      the open panel's slug, or null
 * @param {string|null} args.activeCategory   the open category's slug, or null
 * @param {(panel: string) => string|null} args.parentOf  a panel's category
 * @param {boolean}  args.isLargeScreen       the split (desktop) layout
 *
 * ON A PHONE, BACK RETURNS TO THE PAGE THE USER ACTUALLY CAME FROM.
 *
 * It used to move up the tree with a navigation, and that looped. Moving up
 * went through `smartNavigate`, which PUSHES when the parent is not already
 * behind — true for any panel opened other than from its own category: from
 * another category, from the Privacy panel, from a link or a notification. The
 * Settings root then replaced itself on top of the stranded panel, so from the
 * root Back popped straight into that panel, whose Back pushed its parent
 * again, round and round:
 *
 *     [home, blocked] → [home, blocked, privacy] → [home, blocked, settings]
 *                     → pop → [home, blocked] → …
 *
 * Now Back is a real history pop whenever there is a page of ours behind, and
 * a pop only ever shrinks the stack. When there is nothing behind (a deep
 * link) it goes up the tree by REPLACING the current entry, so the way out
 * never grows the stack either. Neither step can revisit a page already left,
 * so no sequence of presses can cycle.
 *
 * The desktop split view keeps moving up the tree: it shows the tree beside the
 * detail, so "up" is what Back means there, and nothing about it changes.
 */
export function useSettingsBack({ activePanel, activeCategory, parentOf, isLargeScreen }) {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { smartNavigate } = useSmartNavigation();

  const leaveTo = (target) => {
    if (isLargeScreen) return smartNavigate(target);
    if (canGoBackInApp()) return goBack(target);
    return navigate(target, { replace: true });
  };

  /** Closing a panel: after a save, or from the header. */
  const closePanel = () => {
    const parent = activePanel ? parentOf(activePanel) : null;
    leaveTo(parent ? `/settings/${parent}` : '/settings');
  };

  /** The header's back button. Leaving the root leaves Settings. */
  const goUp = () => {
    if (activePanel) return closePanel();
    if (activeCategory) return leaveTo('/settings');
    return goBack('/home');
  };

  return { goUp, closePanel };
}

export default useSettingsBack;

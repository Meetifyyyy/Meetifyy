import { Link } from 'react-router-dom';
import { Bug, Inbox, Lightbulb, ShieldAlert } from '@shared/components/icons';
import { useAuth } from '@shared/context/AuthContext';
import { HELP_VIEWS } from './helpHub';
import styles from './HelpHub.module.css';

/** `modal` tiles open a form in place; `view` tiles go to a hub view. */
const ACTIONS = [
  { modal: 'problem', label: 'Report a problem', hint: 'Something is not working', icon: Bug, tone: 'orange' },
  // Signed-in only: requests are listed by account, so a visitor has none to see.
  { view: HELP_VIEWS.REQUESTS, label: 'Your requests', hint: 'Follow what you sent us', icon: Inbox, tone: 'blue', signedIn: true },
  { view: HELP_VIEWS.SAFETY, label: 'Safety centre', hint: 'Report, block, helplines', icon: ShieldAlert, tone: 'red' },
  { modal: 'idea', label: 'Share an idea', hint: 'Tell us what to build', icon: Lightbulb, tone: 'amber' },
];

/**
 * The four things people come to Help for, as tiles: two columns on a phone,
 * four in a row where there is room.
 *
 * @param {object} p
 * @param {(view: string) => string} p.linkFor  URL for a hub view
 * @param {(kind: 'problem'|'idea') => void} p.onOpen  opens SupportRequestModal
 */
export default function HelpActions({ linkFor, onOpen }) {
  const { currentUser } = useAuth();
  const actions = ACTIONS.filter((a) => !a.signedIn || currentUser);
  return (
    <nav className={styles.actions} aria-label="Help actions" data-count={actions.length}>
      {actions.map(({ view, modal, label, hint, icon: Icon, tone }) => {
        const inner = (
          <>
            <span className={styles.actionIcon} aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className={styles.actionLabel}>{label}</span>
            <span className={styles.actionHint}>{hint}</span>
          </>
        );
        return modal ? (
          <button
            key={modal}
            type="button"
            className={styles.action}
            data-tone={tone}
            aria-haspopup="dialog"
            onClick={() => onOpen(modal)}
          >
            {inner}
          </button>
        ) : (
          <Link key={view} to={linkFor(view)} className={styles.action} data-tone={tone}>
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}

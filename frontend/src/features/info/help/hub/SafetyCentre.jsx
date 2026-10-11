import { Link } from 'react-router-dom';
import { Ban, ChevronRight, Flag, Lock, Phone, ShieldAlert } from '@shared/components/icons';
import { EMERGENCY_NUMBER, HELPLINES } from './helpHub';
import styles from './HelpHub.module.css';

/**
 * Safety centre: the urgent line first, then free helplines, then what the app
 * itself can do. Numbers are `tel:` links, so one tap dials on a phone; on a
 * desktop the number is still readable.
 *
 * @param {object} p
 * @param {(kind: 'problem'|'idea') => void} p.onOpen  opens the report modal
 */
export default function SafetyCentre({ onOpen }) {
  return (
    <div className={styles.stack}>
      <a className={styles.emergency} href={`tel:${EMERGENCY_NUMBER.number}`}>
        <span className={styles.emergencyIcon} aria-hidden="true">
          <ShieldAlert size={20} />
        </span>
        <span className={styles.emergencyText}>
          <strong>In immediate danger?</strong>
          <span>Call {EMERGENCY_NUMBER.number} for police, fire or ambulance.</span>
        </span>
        <span className={styles.emergencyCall}>Call {EMERGENCY_NUMBER.number}</span>
      </a>

      <section aria-labelledby="safety-talk">
        <h3 className={styles.blockTitle} id="safety-talk">Talk to someone</h3>
        <p className={styles.blockIntro}>Free and confidential. You do not need to give your name.</p>
        <ul className={styles.card}>
          {HELPLINES.map((line) => (
            <li key={line.number}>
              <a className={styles.lineRow} href={`tel:${line.number}`}>
                <span className={styles.rowIcon} aria-hidden="true">
                  <Phone size={18} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{line.name}</span>
                  <span className={styles.rowSub}>{line.detail}</span>
                </span>
                <span className={styles.number}>{line.number}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="safety-app">
        <h3 className={styles.blockTitle} id="safety-app">Staying safe on Meetifyy</h3>
        <ul className={styles.card}>
          <li className={styles.tipRow}>
            <span className={styles.rowIcon} aria-hidden="true"><Flag size={18} /></span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>Report a person, post or message</span>
              <span className={styles.rowSub}>
                Open the ⋯ menu on it and choose Report. Reports are confidential: the person is never told who reported them.
              </span>
            </span>
          </li>
          <li className={styles.tipRow}>
            <span className={styles.rowIcon} aria-hidden="true"><Ban size={18} /></span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>Block someone</span>
              <span className={styles.rowSub}>
                They can no longer message you, see your posts or find your profile. You can unblock from Settings at any time.
              </span>
            </span>
          </li>
          <li className={styles.tipRow}>
            <span className={styles.rowIcon} aria-hidden="true"><Lock size={18} /></span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>Meetifyy will never ask for your password</span>
              <span className={styles.rowSub}>
                Not by message, email or call. Anyone who does is not us: block and report them.
              </span>
            </span>
          </li>
        </ul>
      </section>

      <div className={styles.card}>
        <button type="button" className={styles.linkRow} onClick={() => onOpen('problem')} aria-haspopup="dialog">
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>Tell our safety team</span>
            <span className={styles.rowSub}>
              For anything you cannot report from a menu. Choose Safety &amp; Reporting as the area.
            </span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className={styles.chev} />
        </button>
        <Link className={styles.linkRow} to="/community-guidelines">
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>Community guidelines</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className={styles.chev} />
        </Link>
      </div>
    </div>
  );
}

/**
 * The line at the top of the share dialog that says WHAT is being shared —
 * the same identity the chat card will show the recipient: who wrote the
 * post, whose profile, which community, which activity.
 */
import { SHARE_KIND } from '@shared/lib/share/content';
import { activityLabels, compactCount } from '@shared/lib/share/story/model';
import styles from './ShareSheet.module.css';

function postSummary(content) {
  const text = content.text.replace(/\s+/g, ' ').trim();
  if (text) return text;
  if (content.poll) return 'Poll';
  const n = content.images.length;
  return n > 1 ? `${n} photos` : n === 1 ? 'Photo' : 'Post';
}

function describe(content) {
  switch (content.kind) {
    case SHARE_KIND.POST:
      return {
        image: content.author.avatar,
        round: true,
        initial: content.author.name,
        title: content.author.name,
        subtitle: postSummary(content),
      };
    case SHARE_KIND.PROFILE:
      return {
        image: content.avatar,
        round: true,
        initial: content.name,
        title: content.name,
        subtitle: content.username ? `@${content.username}` : '',
      };
    case SHARE_KIND.COMMUNITY:
      return {
        image: content.avatar,
        round: false,
        initial: content.name,
        title: content.name,
        subtitle: `${compactCount(content.memberCount)} ${content.memberCount === 1 ? 'member' : 'members'}`,
      };
    case SHARE_KIND.ACTIVITY:
      return {
        image: content.image,
        round: false,
        initial: content.title,
        title: content.title,
        subtitle: activityLabels(content).meta,
      };
    default:
      return null;
  }
}

export default function SubjectPreview({ content }) {
  const d = describe(content);
  if (!d) return null;
  return (
    <div className={styles.subject}>
      {d.image ? (
        <img
          src={d.image}
          alt=""
          className={`${styles.subjectThumb} ${d.round ? styles.round : ''}`}
          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        />
      ) : (
        <span className={`${styles.subjectThumb} ${styles.subjectInitial} ${d.round ? styles.round : ''}`} aria-hidden="true">
          {(d.initial || '?').trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className={styles.subjectText}>
        <span className={styles.subjectTitle}>{d.title}</span>
        {d.subtitle && <span className={styles.subjectSubtitle}>{d.subtitle}</span>}
      </span>
    </div>
  );
}

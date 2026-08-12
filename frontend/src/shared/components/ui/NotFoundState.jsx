import { useSmartBack } from '@shared/hooks/useSmartBack';
import styles from './NotFoundState.module.css';

function DefaultRedXIcon() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

const CONFIG_BY_TYPE = {
  post: {
    title: 'Post not found',
    message: 'This post may have been removed or deleted.',
  },
  activity: {
    title: 'Activity not found',
    message: 'This activity may have been ended, deleted, or is no longer available.',
  },
  event: {
    title: 'Event not found',
    message: 'This event may have been removed or is no longer available.',
  },
  user: {
    title: 'User not found',
    message: "This profile doesn't exist or may have been deleted.",
  },
  profile: {
    title: 'User not found',
    message: "This profile doesn't exist or may have been deleted.",
  },
  community: {
    title: 'Community not found',
    message: "This community doesn't exist or may have been deleted.",
  },
  page: {
    title: 'Page not found',
    message: "That page doesn't exist or has been moved.",
  },
};

export default function NotFoundState({
  type = 'page',
  title,
  message,
  actionLabel = 'Back to Home Feed',
  onAction,
  icon: customIcon,
  coverPage = true,
  className = '',
}) {
  const goBack = useSmartBack();
  const normalizedType = CONFIG_BY_TYPE[type] ? type : 'page';
  const config = CONFIG_BY_TYPE[normalizedType];

  const finalTitle = title || config.title;
  const finalMessage = message || config.message;
  const finalActionLabel = actionLabel;

  const handlePrimaryClick = () => {
    if (onAction) {
      onAction();
    } else {
      goBack('/home');
    }
  };

  const content = (
    <div className={`${styles.container} ${className}`}>
      <div className={styles.iconWrapper}>
        {customIcon ? customIcon : <DefaultRedXIcon />}
      </div>
      <h2 className={styles.title}>{finalTitle}</h2>
      {finalMessage && <p className={styles.message}>{finalMessage}</p>}
      <div className={styles.actions}>
        <button
          type="button"
          onClick={handlePrimaryClick}
          className={styles.primaryBtn}
        >
          {finalActionLabel}
        </button>
      </div>
    </div>
  );

  if (coverPage) {
    return <div className={styles.fullPageWrapper}>{content}</div>;
  }

  return content;
}

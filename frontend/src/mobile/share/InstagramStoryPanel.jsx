/**
 * The Instagram Story step of the share dialog. Installed app only — loaded
 * from `ShareSheet` behind `IS_MOBILE_BUILD`.
 *
 * Shows the story exactly as Instagram will receive it — the card drawn over
 * the same two background colours Instagram paints — then hands it over. One
 * status line carries every state; there is no per-element skeleton.
 */
import { STORY_BACKGROUND } from '@shared/lib/share/story/model';
import { storyMessage, useInstagramStory } from './useInstagramStory';
import styles from './InstagramStoryPanel.module.css';

const STATUS = {
  preparing: 'Generating story…',
  opening: 'Opening Instagram…',
  shared: 'Sent to Instagram. Finish your story there.',
};

export default function InstagramStoryPanel({ content, onBack, onDone }) {
  const { state, card, share, retry } = useInstagramStory(content);
  const { phase } = state;
  const busy = phase === 'preparing' || phase === 'opening';
  const problem = phase === 'error' || phase === 'unavailable';

  return (
    <div className={styles.panel}>
      <div
        className={styles.frame}
        style={{ background: `linear-gradient(180deg, ${STORY_BACKGROUND.top}, ${STORY_BACKGROUND.bottom})` }}
        aria-busy={phase === 'preparing'}
      >
        {card ? (
          <img
            src={card.previewUrl}
            alt="Story card preview"
            className={styles.card}
            style={{ aspectRatio: `${card.width} / ${card.height}` }}
          />
        ) : phase === 'preparing' ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : null}
      </div>

      <p
        className={`${styles.status} ${problem ? styles.statusError : ''}`}
        role={problem ? 'alert' : 'status'}
        aria-live="polite"
      >
        {problem ? storyMessage(state.code) : STATUS[phase] || 'You can move and resize the card in Instagram.'}
      </p>

      <div className={styles.actions}>
        {phase === 'shared' ? (
          <>
            <button type="button" className={styles.secondary} onClick={share}>Share again</button>
            <button type="button" className={styles.primary} onClick={onDone}>Done</button>
          </>
        ) : (
          <>
            <button type="button" className={styles.secondary} onClick={onBack} disabled={phase === 'opening'}>
              Back
            </button>
            {problem && state.code !== 'not_configured' && state.code !== 'MISSING_APP_ID' && state.code !== 'unsupported_platform' ? (
              <button type="button" className={styles.primary} onClick={retry}>
                {phase === 'unavailable' ? 'Check again' : 'Try again'}
              </button>
            ) : (
              <button
                type="button"
                className={styles.primary}
                onClick={share}
                disabled={phase !== 'ready'}
              >
                {busy ? <span className={styles.buttonSpinner} aria-hidden="true" /> : null}
                Share to Instagram
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

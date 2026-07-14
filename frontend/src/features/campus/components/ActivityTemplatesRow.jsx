import { useNavigate } from 'react-router-dom';
import styles from './ActivityTemplatesRow.module.css';

export default function ActivityTemplatesRow({ returnTo = '/campus' }) {
  const navigate = useNavigate();

  return (
    <div className={styles.templatesRow} style={{ paddingTop: '0.5rem', paddingBottom: '1rem', marginTop: '-0.5rem', marginBottom: '-1rem' }}>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>☕</span>
        <span className={styles.templateTitle}>Coffee Meetup</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Coffee Meetup', coverImage: 'https://media.giphy.com/media/l0Iy6MiE0JJkimBIA/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>🍿</span>
        <span className={styles.templateTitle}>Movie Night</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Movie Night', coverImage: 'https://media.giphy.com/media/3o7527pa7qs9kCG78A/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>🎮</span>
        <span className={styles.templateTitle}>Gaming Night</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Gaming Night', coverImage: 'https://media.giphy.com/media/XABKMfQtWhvVq/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>🚶</span>
        <span className={styles.templateTitle}>Campus Walk</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Campus Walk', coverImage: 'https://media.giphy.com/media/3o6Mb57gCEJqpMxF68/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>🍕</span>
        <span className={styles.templateTitle}>Free Food</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Free Food', coverImage: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>🎤</span>
        <span className={styles.templateTitle}>Open Mic</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Open Mic', coverImage: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>🎨</span>
        <span className={styles.templateTitle}>Art Jam</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Art Jam', coverImage: 'https://media.giphy.com/media/l3q2JLW2x2eMm/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>🚀</span>
        <span className={styles.templateTitle}>Hackathon Team</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Hackathon Team', coverImage: 'https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>📖</span>
        <span className={styles.templateTitle}>Study Group</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Study Group', coverImage: 'https://media.giphy.com/media/WoWm8YzFQJg5i/giphy.gif' } } })}>+ Add</button>
      </div>
      <div className={styles.templateCard}>
        <span className={styles.templateEmoji}>⚽</span>
        <span className={styles.templateTitle}>Sports Match</span>
        <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo, prefill: { title: 'Sports Match', coverImage: 'https://media.giphy.com/media/dXZfCHX4Hqvdm/giphy.gif' } } })}>+ Add</button>
      </div>
    </div>
  );
}

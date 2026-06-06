import heroBg from '../../assets/images/hero-bg.webp';
import styles from './Background.module.css';

export default function Background() {
  return (
    <img
      className={styles.bgFull}
      src={heroBg}
      alt=""
      fetchPriority="high"
    />
  );
}

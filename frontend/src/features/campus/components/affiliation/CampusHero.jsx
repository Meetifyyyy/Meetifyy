import campusHero from '@assets/images/campus_hero.webp';
import styles from './CampusAffiliation.module.css';

/**
 * The top of the college picker: the "Find your campus" picture, with the page's
 * heading for screen readers (the words are part of the artwork).
 *
 * The picture's own transparent lower edge does the softening; nothing is
 * drawn over it or masked. Sizing and cropping are in
 * CampusAffiliation.module.css (read the comment above `.hero`): the box always
 * shows the lettering and the whole building, and the sides are what a narrow
 * screen crops.
 */
export default function CampusHero() {
  return (
    <div className={styles.heroFrame}>
      <div className={styles.hero}>
        <h1 className={styles.heroSr}>Find your campus</h1>
        <img
          className={styles.heroImg}
          src={campusHero}
          width="1350"
          height="668"
          alt=""
          decoding="async"
          draggable={false}
        />
      </div>
    </div>
  );
}

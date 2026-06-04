import heroBg from '../../assets/images/hero-bg.webp';

export default function Background() {
  return (
    <img
      className="bg-full"
      src={heroBg}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

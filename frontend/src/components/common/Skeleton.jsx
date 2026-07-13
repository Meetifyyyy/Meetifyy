import styles from './Skeleton.module.css';

export default function Skeleton({ type = 'rect', width, height, className = '', style = {} }) {
  const mergedStyle = {
    width: width || (type === 'circle' ? '40px' : '100%'),
    height: height || (type === 'circle' ? '40px' : type === 'text' ? '1rem' : '100%'),
    borderRadius: type === 'circle' ? '50%' : type === 'text' ? '4px' : '8px',
    ...style
  };

  return (
    <div 
      className={`${styles.skeleton} ${styles[type]} ${className}`} 
      style={mergedStyle}
    />
  );
}

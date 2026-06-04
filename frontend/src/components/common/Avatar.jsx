export default function Avatar({ letter, size = 36, gradient, className = '', style = {} }) {
  const defaultGradient = 'linear-gradient(135deg, #6D5DFC, #A855F7)';
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: gradient || defaultGradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Outfit', sans-serif",
        fontWeight: 600,
        color: '#fff',
        flexShrink: 0,
        ...style,
      }}
    >
      {letter}
    </div>
  );
}

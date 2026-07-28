export function isImageUrl(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  return (
    s.startsWith('/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:') ||
    s.startsWith('blob:') ||
    s.startsWith('src/') ||
    s.startsWith('assets/') ||
    s.includes('default_avatar') ||
    s.endsWith('.webp') ||
    s.endsWith('.png') ||
    s.endsWith('.jpg') ||
    s.endsWith('.jpeg') ||
    s.endsWith('.svg') ||
    s.endsWith('.gif')
  );
}

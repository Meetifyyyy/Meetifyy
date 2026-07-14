export function isImageUrl(str) {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('/') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:') || str.startsWith('blob:');
}

export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function parseTimeString(timeStr) {
  if (!timeStr) return Date.now();
  if (timeStr.toLowerCase() === 'just now') return Date.now();
  const match = timeStr.match(/(\d+)\s+(min|minute|hr|hour|d|day|w|week|mo|month)s?\s+ago/i);
  if (match) {
    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const now = Date.now();
    if (unit.startsWith('min')) return now - val * 60 * 1000;
    if (unit.startsWith('h')) return now - val * 60 * 60 * 1000;
    if (unit.startsWith('d')) return now - val * 24 * 60 * 60 * 1000;
    if (unit.startsWith('w')) return now - val * 7 * 24 * 60 * 60 * 1000;
    if (unit.startsWith('mo')) return now - val * 30 * 24 * 60 * 60 * 1000;
  }
  return Date.now() - 2 * 60 * 60 * 1000;
}

export function getRelativeDateLabel(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  if (target.getTime() === today.getTime()) {
    return 'Today';
  } else if (target.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  } else {
    const options = { day: 'numeric', month: 'short' };
    if (target.getFullYear() !== today.getFullYear()) {
      options.year = 'numeric';
    }
    return date.toLocaleDateString('en-US', options);
  }
}

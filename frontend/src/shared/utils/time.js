export function timeAgo(timestamp) {
  if (!timestamp) return '';
  
  let date;
  if (typeof timestamp === 'number' || timestamp instanceof Date) {
    date = new Date(timestamp);
  } else if (typeof timestamp === 'string') {
    date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      date = new Date(parseTimeString(timestamp));
    }
  } else {
    date = new Date(timestamp);
  }

  const time = date.getTime();
  if (isNaN(time)) return typeof timestamp === 'string' ? timestamp : '';

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 1) return '1s';
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 3) return `${days}d`;

  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = 'numeric';
  }

  return date.toLocaleDateString('en-US', options);
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

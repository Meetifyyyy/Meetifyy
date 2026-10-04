/**
 * The viewer item for one attachment tapped in a chat.
 *
 * `MessageBubble` calls `onOpenMediaModal(url, type, extra)`. `extra` carries what
 * only the bubble knows - the report target (the message, never the URL), a
 * thumbnail, an item id - and it has to reach the viewer intact, or the viewer can
 * only guess what it is being asked to report. Both chat surfaces (Messages and
 * Instant Match) build their item here so they cannot drift apart.
 *
 * @param {string} url
 * @param {'image'|'video'} [type]
 * @param {{ report?: object, thumb?: string, id?: string }} [extra]
 */
export function chatMediaItem(url, type, extra) {
  const item = { url, type: type || 'image' };
  if (extra && typeof extra === 'object') {
    if (extra.thumb) item.thumb = extra.thumb;
    if (extra.id) item.id = extra.id;
    if (extra.report) item.report = extra.report;
  }
  return item;
}

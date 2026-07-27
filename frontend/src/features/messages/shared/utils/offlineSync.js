const OFFLINE_QUEUE_KEY = 'meetifyy_pending_messages';

export function getPendingQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function queuePendingMessage(msgPayload) {
  const queue = getPendingQueue();
  queue.push(msgPayload);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to store pending offline message', e);
  }
}

export function removePendingMessage(tempId) {
  const queue = getPendingQueue().filter(m => m.tempId !== tempId);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to remove pending offline message', e);
  }
}

export function flushPendingQueue(socket, onAck) {
  const queue = getPendingQueue();
  if (queue.length === 0 || !socket || !socket.connected) return;

  queue.forEach((msg) => {
    socket.emit('message:send', msg, (ack) => {
      if (ack?.status === 'ok') {
        removePendingMessage(msg.tempId);
        if (onAck) onAck(msg.tempId, ack.message);
      }
    });
  });
}

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
  const key = msgPayload.clientId || msgPayload.tempId;
  const exists = queue.some(m => (m.clientId && m.clientId === key) || (m.tempId && m.tempId === key));
  if (!exists) {
    queue.push(msgPayload);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('Failed to store pending offline message', e);
    }
  }
}

export function removePendingMessage(tempId) {
  if (!tempId) return;
  const queue = getPendingQueue().filter(m => m.tempId !== tempId && m.clientId !== tempId);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to remove pending offline message', e);
  }
}

export async function flushPendingQueue(socket, onAck) {
  const queue = getPendingQueue();
  if (queue.length === 0 || !socket || !socket.connected) return;

  for (const msg of queue) {
    const key = msg.clientId || msg.tempId;
    await new Promise((resolve) => {
      socket.emit('message:send', msg, (ack) => {
        if (ack?.status === 'ok') {
          removePendingMessage(key);
          if (onAck) onAck(key, ack.message, 'ok');
        } else {
          // Keep the message in the queue but notify the caller so the UI
          // can mark it 'failed' instead of leaving it stuck at 'sending'.
          if (onAck) onAck(key, null, 'failed');
        }
        resolve();
      });
    });
  }
}


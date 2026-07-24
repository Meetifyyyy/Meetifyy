export class MessageQueueManager {
  constructor() {
    this.queues = new Map(); // conversationId -> Array of functions returning Promises
    this.processing = new Set(); // Set of conversationIds currently being processed
  }

  static instance = null;

  static getInstance() {
    if (!MessageQueueManager.instance) {
      MessageQueueManager.instance = new MessageQueueManager();
    }
    return MessageQueueManager.instance;
  }

  enqueue(conversationId, asyncTask) {
    if (!this.queues.has(conversationId)) {
      this.queues.set(conversationId, []);
    }
    this.queues.get(conversationId).push(asyncTask);
    this.processQueue(conversationId);
  }

  async processQueue(conversationId) {
    if (this.processing.has(conversationId)) {
      return;
    }
    
    this.processing.add(conversationId);
    const queue = this.queues.get(conversationId);

    while (queue && queue.length > 0) {
      const task = queue.shift();
      try {
        await task();
      } catch (err) {
        console.error(`MessageQueueManager: Task failed for conversation ${conversationId}`, err);
      }
    }

    this.processing.delete(conversationId);
  }
}

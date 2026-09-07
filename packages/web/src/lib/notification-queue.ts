export const NOTIFICATION_BUBBLE_QUEUE_MAX = 3;

export interface QueuedBubbleLike {
  isPermissionPrompt: boolean;
}

export interface EnqueueBubbleResult<T> {
  /** The resulting queue; index 0 is the displayed head. */
  queue: T[];
  /** False when the incoming bubble was dropped instead of enqueued. */
  accepted: boolean;
  /** The bubble evicted to make room, if any. Never the head. */
  evicted: T | null;
}

/**
 * Appends a bubble to a FIFO queue of at most `max` entries. When the queue is
 * full, the oldest queued non-permission_prompt bubble (never the displayed
 * head at index 0) is evicted to make room; if every queued bubble behind the
 * head is a permission_prompt, the incoming bubble is dropped instead.
 */
export function enqueueBubble<T extends QueuedBubbleLike>(
  queue: readonly T[],
  next: T,
  max: number = NOTIFICATION_BUBBLE_QUEUE_MAX
): EnqueueBubbleResult<T> {
  if (queue.length < max) {
    return { queue: [...queue, next], accepted: true, evicted: null };
  }
  for (let index = 1; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (candidate && !candidate.isPermissionPrompt) {
      return {
        queue: [...queue.slice(0, index), ...queue.slice(index + 1), next],
        accepted: true,
        evicted: candidate,
      };
    }
  }
  return { queue: [...queue], accepted: false, evicted: null };
}

/** Removes the displayed head; the next queued bubble becomes the new head. */
export function dequeueBubble<T>(queue: readonly T[]): T[] {
  return queue.slice(1);
}

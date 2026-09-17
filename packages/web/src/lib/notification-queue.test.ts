import { describe, expect, it } from "vitest";

import {
  dequeueBubble,
  enqueueBubble,
  NOTIFICATION_BUBBLE_QUEUE_MAX,
} from "./notification-queue";

interface TestBubble {
  id: string;
  isPermissionPrompt: boolean;
}

function bubble(id: string, isPermissionPrompt = false): TestBubble {
  return { id, isPermissionPrompt };
}

describe("enqueueBubble", () => {
  it("keeps FIFO ordering while below the cap", () => {
    // Arrange
    let queue: TestBubble[] = [];

    // Act
    queue = enqueueBubble(queue, bubble("a")).queue;
    queue = enqueueBubble(queue, bubble("b", true)).queue;
    queue = enqueueBubble(queue, bubble("c")).queue;

    // Assert
    expect(queue.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("caps the queue at the maximum size", () => {
    // Arrange
    let queue: TestBubble[] = [];
    for (const id of ["a", "b", "c"]) {
      queue = enqueueBubble(queue, bubble(id, true)).queue;
    }

    // Act
    const result = enqueueBubble(queue, bubble("d", true));

    // Assert
    expect(result.queue.length).toBe(NOTIFICATION_BUBBLE_QUEUE_MAX);
  });

  it("evicts the oldest queued non-permission bubble when full", () => {
    // Arrange
    const queue = [bubble("head", true), bubble("old"), bubble("newer", true)];

    // Act
    const result = enqueueBubble(queue, bubble("incoming"));

    // Assert
    expect(result.accepted).toBe(true);
    expect(result.evicted?.id).toBe("old");
    expect(result.queue.map((entry) => entry.id)).toEqual(["head", "newer", "incoming"]);
  });

  it("never evicts the displayed head, even when it is not a permission prompt", () => {
    // Arrange: head is a plain notification, everything behind it is a prompt.
    const queue = [bubble("head"), bubble("p1", true), bubble("p2", true)];

    // Act
    const result = enqueueBubble(queue, bubble("incoming"));

    // Assert: no evictable slot exists behind the head, so the incoming bubble is dropped.
    expect(result.accepted).toBe(false);
    expect(result.evicted).toBeNull();
    expect(result.queue.map((entry) => entry.id)).toEqual(["head", "p1", "p2"]);
  });

  it("drops the incoming bubble when every queued bubble is a permission prompt", () => {
    // Arrange
    const queue = [bubble("p1", true), bubble("p2", true), bubble("p3", true)];

    // Act
    const result = enqueueBubble(queue, bubble("p4", true));

    // Assert
    expect(result.accepted).toBe(false);
    expect(result.evicted).toBeNull();
    expect(result.queue.map((entry) => entry.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("evicts a non-permission bubble to make room for an incoming permission prompt", () => {
    // Arrange
    const queue = [bubble("head", true), bubble("old"), bubble("newer")];

    // Act
    const result = enqueueBubble(queue, bubble("incoming", true));

    // Assert
    expect(result.accepted).toBe(true);
    expect(result.evicted?.id).toBe("old");
    expect(result.queue.map((entry) => entry.id)).toEqual(["head", "newer", "incoming"]);
  });
});

describe("dequeueBubble", () => {
  it("removes the head and promotes the next queued bubble", () => {
    // Arrange
    const queue = [bubble("a"), bubble("b"), bubble("c")];

    // Act
    const rest = dequeueBubble(queue);

    // Assert
    expect(rest.map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("returns an empty queue when the last bubble is dismissed", () => {
    // Arrange / Act / Assert
    expect(dequeueBubble([bubble("a")])).toEqual([]);
    expect(dequeueBubble([])).toEqual([]);
  });
});

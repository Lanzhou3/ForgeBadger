export interface WebSocketConnectionLimitOptions {
  readonly maxGlobalConnections: number;
  readonly maxConnectionsPerUser: number;
}

export interface WebSocketConnectionLimitResult {
  accepted: boolean;
  reason?: "global" | "per_user";
}

export interface WebSocketConnection {
  close(code?: number, reason?: string): void;
}

export class WebSocketConnectionLimits<T extends WebSocketConnection> {
  private readonly sockets = new Set<T>();
  private readonly socketsByUser = new Map<string, Set<T>>();
  private readonly userBySocket = new Map<T, string>();

  constructor(private readonly options: WebSocketConnectionLimitOptions) {}

  tryAcquire(socket: T, userId: string): WebSocketConnectionLimitResult {
    if (this.sockets.size >= this.options.maxGlobalConnections) {
      return { accepted: false, reason: "global" };
    }

    const userSockets = this.getUserSockets(userId);
    if (userSockets.size >= this.options.maxConnectionsPerUser) {
      return { accepted: false, reason: "per_user" };
    }

    this.sockets.add(socket);
    userSockets.add(socket);
    this.userBySocket.set(socket, userId);
    return { accepted: true };
  }

  release(socket: T): void {
    const userId = this.userBySocket.get(socket);
    if (!userId) {
      return;
    }

    this.userBySocket.delete(socket);
    this.sockets.delete(socket);

    const userSockets = this.socketsByUser.get(userId);
    if (!userSockets) {
      return;
    }

    userSockets.delete(socket);
    if (userSockets.size === 0) {
      this.socketsByUser.delete(userId);
    }
  }

  private getUserSockets(userId: string): Set<T> {
    const existing = this.socketsByUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Set<T>();
    this.socketsByUser.set(userId, created);
    return created;
  }
}

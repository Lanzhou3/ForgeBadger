import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SessionRecoveryStore, StoredSession } from "./session-manager.js";

interface RecoveryIndexFile {
  version: 1;
  sessions: StoredSession[];
}

export function createJsonSessionRecoveryStore(projectRoot: string): SessionRecoveryStore {
  return new JsonSessionRecoveryStore(join(projectRoot, ".forgebadger", "gate-a-sessions.json"));
}

class JsonSessionRecoveryStore implements SessionRecoveryStore {
  constructor(private readonly filePath: string) {}

  async listSessions(): Promise<StoredSession[]> {
    const index = await this.readIndex();
    return index.sessions;
  }

  async upsertSession(session: StoredSession): Promise<void> {
    const index = await this.readIndex();
    index.sessions = index.sessions.filter((current) => current.id !== session.id);
    index.sessions.push(session);
    await this.writeIndex(index);
  }

  async removeSession(id: string, userId: string): Promise<void> {
    const index = await this.readIndex();
    index.sessions = index.sessions.filter((session) => session.id !== id || session.userId !== userId);
    await this.writeIndex(index);
  }

  private async readIndex(): Promise<RecoveryIndexFile> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as RecoveryIndexFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
        return emptyIndex();
      }
      return parsed;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return emptyIndex();
      }
      throw error;
    }
  }

  private async writeIndex(index: RecoveryIndexFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }
}

function emptyIndex(): RecoveryIndexFile {
  return {
    version: 1,
    sessions: []
  };
}

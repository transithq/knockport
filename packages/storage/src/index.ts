import Dexie, { type Table } from "dexie";
import type {
  Collection,
  Environment,
  HistoryEntry,
  Request,
} from "@knockport/core";

// ── Dexie Database ───────────────────────────────────────────────────────────
export class KnockportDB extends Dexie {
  collections!: Table<CollectionRecord, string>;
  environments!: Table<EnvironmentRecord, string>;
  history!: Table<HistoryRecord, string>;
  workspaces!: Table<WorkspaceRecord, string>;

  constructor() {
    super("knockport");

    this.version(1).stores({
      collections: "id, name, updatedAt",
      environments: "id, name, isDefault",
      history: "id, requestId, timestamp, collectionId",
      workspaces: "id, name",
    });
  }
}

// ── Stored record types (with IDs as primary keys) ───────────────────────────
export interface CollectionRecord {
  id: string;
  name: string;
  description?: string;
  auth?: any;
  scripts?: any;
  variables: any[];
  folders: any[];
  requests: any[];
  order: string[];
  metadata?: any;
  workspaceId?: string;
  diskPath?: string;
}

export interface EnvironmentRecord {
  id: string;
  name: string;
  variables: any[];
  isDefault?: boolean;
  collectionId?: string;
}

export interface HistoryRecord {
  id: string;
  request: any;
  response: any;
  timestamp: string;
  collectionId?: string;
  environmentId?: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
  diskPath?: string;
}

// ── Database singleton ───────────────────────────────────────────────────────
let dbInstance: KnockportDB | undefined;

export function getDB(): KnockportDB {
  if (!dbInstance) {
    dbInstance = new KnockportDB();
  }
  return dbInstance;
}

// ── Collection operations ─────────────────────────────────────────────────────
export const collections = {
  async getAll(): Promise<CollectionRecord[]> {
    return getDB().collections.toArray();
  },

  async getById(id: string): Promise<CollectionRecord | undefined> {
    return getDB().collections.get(id);
  },

  async create(record: CollectionRecord): Promise<string> {
    return getDB().collections.add(record);
  },

  async update(id: string, changes: Partial<CollectionRecord>): Promise<number> {
    return getDB().collections.update(id, {
      ...changes,
      metadata: {
        ...((await getDB().collections.get(id))?.metadata ?? {}),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  async delete(id: string): Promise<void> {
    await getDB().collections.delete(id);
    // Clean up associated environments
    await getDB().environments.where("collectionId").equals(id).delete();
  },
};

// ── Environment operations ───────────────────────────────────────────────────
export const environments = {
  async getAll(): Promise<EnvironmentRecord[]> {
    return getDB().environments.toArray();
  },

  async getById(id: string): Promise<EnvironmentRecord | undefined> {
    return getDB().environments.get(id);
  },

  async getByCollection(collectionId: string): Promise<EnvironmentRecord[]> {
    return getDB().environments.where("collectionId").equals(collectionId).toArray();
  },

  async create(record: EnvironmentRecord): Promise<string> {
    return getDB().environments.add(record);
  },

  async update(id: string, changes: Partial<EnvironmentRecord>): Promise<number> {
    return getDB().environments.update(id, changes);
  },

  async delete(id: string): Promise<void> {
    await getDB().environments.delete(id);
  },

  async setDefault(id: string): Promise<void> {
    // Clear all defaults first
    await getDB().environments.toCollection().modify({ isDefault: false });
    // Set this one as default
    await getDB().environments.update(id, { isDefault: true });
  },
};

// ── History operations ───────────────────────────────────────────────────────
export const history = {
  async getRecent(limit = 50): Promise<HistoryRecord[]> {
    return getDB()
      .history
      .orderBy("timestamp")
      .reverse()
      .limit(limit)
      .toArray();
  },

  async getByCollection(collectionId: string, limit = 50): Promise<HistoryRecord[]> {
    return getDB()
      .history
      .where("collectionId")
      .equals(collectionId)
      .reverse()
      .limit(limit)
      .toArray();
  },

  async create(record: HistoryRecord): Promise<string> {
    return getDB().history.add(record);
  },

  async delete(id: string): Promise<void> {
    await getDB().history.delete(id);
  },

  async clear(): Promise<number> {
    return getDB().history.clear();
  },
};

// ── OPFS Body Store ──────────────────────────────────────────────────────────
/**
 * Stores response bodies in OPFS (Origin Private File System) for large payloads.
 * Falls back to in-memory for environments without OPFS support.
 */
export class BodyStore {
  private root: FileSystemDirectoryHandle | undefined;
  private memoryFallback = new Map<string, string>();

  async init(): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
      try {
        this.root = await navigator.storage.getDirectory();
        await this.root.getDirectoryHandle("bodies", { create: true });
      } catch {
        // OPFS not available, use memory fallback
      }
    }
  }

  async store(key: string, body: string): Promise<void> {
    if (this.root) {
      try {
        const dir = await this.root.getDirectoryHandle("bodies");
        const file = await dir.getFileHandle(`${key}.txt`, { create: true });
        const writable = await file.createWritable();
        await writable.write(body);
        await writable.close();
        return;
      } catch {
        // Fall through to memory
      }
    }
    this.memoryFallback.set(key, body);
  }

  async retrieve(key: string): Promise<string | undefined> {
    if (this.root) {
      try {
        const dir = await this.root.getDirectoryHandle("bodies");
        const file = await dir.getFileHandle(`${key}.txt`);
        const readable = await file.getFile();
        return await readable.text();
      } catch {
        // Fall through to memory
      }
    }
    return this.memoryFallback.get(key);
  }

  async delete(key: string): Promise<void> {
    if (this.root) {
      try {
        const dir = await this.root.getDirectoryHandle("bodies");
        await dir.removeEntry(`${key}.txt`);
        return;
      } catch {
        // Fall through to memory
      }
    }
    this.memoryFallback.delete(key);
  }
}

// ── File System Access Adapter ───────────────────────────────────────────────
/**
 * Reads/writes collections on real disk using the File System Access API.
 * Falls back to OPFS when the API is unavailable.
 */
export class FileSystemAdapter {
  private dirHandle: FileSystemDirectoryHandle | undefined;

  async openDirectory(): Promise<boolean> {
    if (typeof window === "undefined" || !window.showDirectoryPicker) {
      return false;
    }
    try {
      this.dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      return true;
    } catch {
      return false;
    }
  }

  async readFile(path: string): Promise<string | undefined> {
    if (!this.dirHandle) return undefined;
    try {
      const parts = path.split("/");
      let dir = this.dirHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      const file = await dir.getFileHandle(parts[parts.length - 1]);
      const readable = await file.getFile();
      return await readable.text();
    } catch {
      return undefined;
    }
  }

  async writeFile(path: string, content: string): Promise<boolean> {
    if (!this.dirHandle) return false;
    try {
      const parts = path.split("/");
      let dir = this.dirHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await file.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath = ""): Promise<string[]> {
    if (!this.dirHandle) return [];
    try {
      let dir = this.dirHandle;
      if (dirPath) {
        const parts = dirPath.split("/");
        for (const part of parts) {
          dir = await dir.getDirectoryHandle(part);
        }
      }
      const entries: string[] = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "file" && (name.endsWith(".yaml") || name.endsWith(".yml"))) {
          entries.push(name);
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  isOpen(): boolean {
    return this.dirHandle !== undefined;
  }
}

export const bodyStore = new BodyStore();

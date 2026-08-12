import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { catalogItems, catalogSources } from "../schema.js";
import type { Database } from "../types.js";

export type CatalogType = "skill" | "template";

export interface CatalogSource {
  id: string;
  userId: string;
  sourceId: string;
  type: CatalogType;
  label: string;
  url: string;
  status: string;
  lastRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogItem {
  id: string;
  userId: string;
  sourceId: string;
  itemType: CatalogType;
  externalId: string;
  name: string;
  description: string | null;
  version: string | null;
  metadata: string | null;
  fetchedAt: Date;
}

export interface UpsertCatalogSourceInput {
  sourceId: string;
  type: CatalogType;
  label: string;
  url: string;
  lastRefreshedAt?: Date | undefined;
}

export interface CreateCatalogItemInput {
  sourceId: string;
  itemType: CatalogType;
  externalId: string;
  name: string;
  description?: string | undefined;
  version?: string | undefined;
  metadata?: unknown;
}

export class CatalogRepository {
  private readonly drizzle;
  private readonly db: Database;

  constructor(db: Database, private readonly userId: string) {
    this.db = db;
    this.drizzle = drizzle(db);
  }

  listSources(): CatalogSource[] {
    return this.drizzle
      .select()
      .from(catalogSources)
      .where(eq(catalogSources.userId, this.userId))
      .orderBy(desc(catalogSources.updatedAt))
      .all() as CatalogSource[];
  }

  listItems(): CatalogItem[] {
    return this.drizzle
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.userId, this.userId))
      .orderBy(desc(catalogItems.fetchedAt))
      .all() as CatalogItem[];
  }

  getItemById(id: string): CatalogItem | undefined {
    return this.drizzle
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.userId, this.userId), eq(catalogItems.id, id)))
      .get() as CatalogItem | undefined;
  }

  upsertSource(input: UpsertCatalogSourceInput): CatalogSource {
    const existing = this.drizzle
      .select()
      .from(catalogSources)
      .where(
        and(
          eq(catalogSources.userId, this.userId),
          eq(catalogSources.type, input.type),
          eq(catalogSources.sourceId, input.sourceId)
        )
      )
      .get() as CatalogSource | undefined;
    const now = new Date();

    if (existing) {
      return this.drizzle
        .update(catalogSources)
        .set({
          label: input.label,
          url: input.url,
          status: "active",
          lastRefreshedAt: input.lastRefreshedAt ?? now,
          updatedAt: now
        })
        .where(eq(catalogSources.id, existing.id))
        .returning()
        .get() as CatalogSource;
    }

    return this.drizzle
      .insert(catalogSources)
      .values({
        userId: this.userId,
        sourceId: input.sourceId,
        type: input.type,
        label: input.label,
        url: input.url,
        status: "active",
        lastRefreshedAt: input.lastRefreshedAt ?? now
      })
      .returning()
      .get() as CatalogSource;
  }

  replaceItems(sourceId: string, items: CreateCatalogItemInput[]): CatalogItem[] {
    // Delete-then-insert must be atomic: if the insert fails mid-way, the
    // catalog keeps its previous complete state instead of being left half
    // empty (a partial refresh would break installs that resolve by id).
    const run = this.db.transaction(() => {
      this.drizzle
        .delete(catalogItems)
        .where(and(eq(catalogItems.userId, this.userId), eq(catalogItems.sourceId, sourceId)))
        .run();

      return items.map((item) =>
        this.drizzle
          .insert(catalogItems)
          .values({
            userId: this.userId,
            sourceId,
            itemType: item.itemType,
            externalId: item.externalId,
            name: item.name,
            description: item.description ?? null,
            version: item.version ?? null,
            metadata: item.metadata === undefined ? null : JSON.stringify(item.metadata)
          })
          .returning()
          .get() as CatalogItem
      );
    });
    return run();
  }
}

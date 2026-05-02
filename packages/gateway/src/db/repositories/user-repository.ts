import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { users } from "../schema.js";
import type { Database } from "../types.js";

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserOptions {
  role?: "admin" | "user" | undefined;
}

export interface UpdateUserInput {
  role?: "admin" | "user" | undefined;
  status?: "active" | "disabled" | undefined;
}

export class UserRepository {
  private drizzle;

  constructor(db: Database) {
    this.drizzle = drizzle(db);
  }

  create(email: string, passwordHash: string, options: CreateUserOptions = {}): User {
    const normalized = email.trim().toLowerCase();
    const result = this.drizzle
      .insert(users)
      .values({
        email: normalized,
        passwordHash,
        username: normalized,
        ...(options.role ? { role: options.role } : {})
      })
      .returning()
      .get();
    return result as User;
  }

  count(): number {
    const result = this.drizzle.select({ id: users.id }).from(users).all();
    return result.length;
  }

  list(): User[] {
    return this.drizzle
      .select()
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.email))
      .all() as User[];
  }

  findByEmail(email: string): User | undefined {
    const result = this.drizzle
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .get();
    return result as User | undefined;
  }

  findById(id: string): User | undefined {
    const result = this.drizzle.select().from(users).where(eq(users.id, id)).get();
    return result as User | undefined;
  }

  update(id: string, input: UpdateUserInput): User | undefined {
    const updateData: Record<string, unknown> = {};
    if (input.role !== undefined) updateData.role = input.role;
    if (input.status !== undefined) updateData.status = input.status;

    if (Object.keys(updateData).length === 0) {
      return this.findById(id);
    }

    const result = this.drizzle
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning()
      .get();
    return result as User | undefined;
  }
}

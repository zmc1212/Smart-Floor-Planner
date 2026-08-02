import { and, desc, eq } from 'drizzle-orm';
import { aiChatSessions } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiChatSessionRecord = typeof aiChatSessions.$inferSelect;
export type NewAiChatSession = typeof aiChatSessions.$inferInsert;
export type AiChatMessage = Record<string, unknown> & {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
};

export class AiChatSessionRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  list(enterpriseId: bigint, adminId: bigint) {
    return this.transaction
      .select()
      .from(aiChatSessions)
      .where(
        and(
          eq(aiChatSessions.enterpriseId, enterpriseId),
          eq(aiChatSessions.adminId, adminId)
        )
      )
      .orderBy(desc(aiChatSessions.lastMessageAt))
      .limit(50);
  }

  async findById(id: bigint, enterpriseId: bigint, adminId: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiChatSessions)
      .where(
        and(
          eq(aiChatSessions.id, id),
          eq(aiChatSessions.enterpriseId, enterpriseId),
          eq(aiChatSessions.adminId, adminId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewAiChatSession) {
    const rows = await this.transaction.insert(aiChatSessions).values(input).returning();
    return rows[0];
  }

  async appendMessage(id: bigint, enterpriseId: bigint, adminId: bigint, message: AiChatMessage) {
    const session = await this.findById(id, enterpriseId, adminId);
    if (!session) return null;
    const rows = await this.transaction
      .update(aiChatSessions)
      .set({
        messages: [...session.messages, message],
        lastMessageAt: message.createdAt,
        updatedAt: new Date(),
      })
      .where(eq(aiChatSessions.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updateTitle(id: bigint, enterpriseId: bigint, adminId: bigint, title: string) {
    const session = await this.findById(id, enterpriseId, adminId);
    if (!session) return null;
    const rows = await this.transaction
      .update(aiChatSessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(aiChatSessions.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: bigint, enterpriseId: bigint, adminId: bigint) {
    const rows = await this.transaction
      .delete(aiChatSessions)
      .where(
        and(
          eq(aiChatSessions.id, id),
          eq(aiChatSessions.enterpriseId, enterpriseId),
          eq(aiChatSessions.adminId, adminId)
        )
      )
      .returning({ id: aiChatSessions.id });
    return rows.length > 0;
  }
}

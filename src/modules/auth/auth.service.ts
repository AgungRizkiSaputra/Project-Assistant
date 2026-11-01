import { SupabaseClient } from '@supabase/supabase-js';
import { Database, UserRow } from '../../db/types.js';
import { logger } from '../../config/logger.js';

export type UserRecord = UserRow;

export class AuthService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private allowedTelegramIds: number[]
  ) {}

  /**
   * Check if Telegram user is allowed to access the bot
   */
  isUserAllowed(telegramId: number): boolean {
    return this.allowedTelegramIds.includes(telegramId);
  }

  /**
   * Ensure user exists in database and update last_active_at
   */
  async getOrCreateUser(telegramUser: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<UserRecord | null> {
    const isAllowed = this.isUserAllowed(telegramUser.id);
    if (!isAllowed) {
      logger.warn({ telegramId: telegramUser.id }, 'Unauthorized access attempt');
      return null;
    }

    const { data: existingUser, error: selectError } = await (this.supabase as any)
      .from('users')
      .select('*')
      .eq('telegram_id', telegramUser.id)
      .maybeSingle();

    if (selectError) {
      logger.error({ error: selectError, telegramId: telegramUser.id }, 'Error querying user');
      throw selectError;
    }

    const now = new Date().toISOString();

    if (existingUser) {
      const { data: updatedUser, error: updateError } = await (this.supabase as any)
        .from('users')
        .update({
          username: telegramUser.username ?? existingUser.username,
          first_name: telegramUser.first_name ?? existingUser.first_name,
          last_name: telegramUser.last_name ?? existingUser.last_name,
          last_active_at: now,
        })
        .eq('id', existingUser.id)
        .select()
        .single();

      if (updateError) {
        logger.error({ error: updateError }, 'Error updating user last_active_at');
        return existingUser as UserRecord;
      }
      return updatedUser as UserRecord;
    }

    // Insert new user
    const { data: newUser, error: insertError } = await (this.supabase as any)
      .from('users')
      .insert({
        telegram_id: telegramUser.id,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        is_allowed: true,
        last_active_at: now,
      })
      .select()
      .single();

    if (insertError) {
      logger.error({ error: insertError }, 'Error creating new user');
      throw insertError;
    }

    logger.info({ userId: newUser.id, telegramId: newUser.telegram_id }, 'Registered new user');
    return newUser as UserRecord;
  }
}

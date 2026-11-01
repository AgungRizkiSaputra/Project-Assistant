import { Context, MiddlewareFn } from 'grammy';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../db/types.js';
import { logger } from '../../config/logger.js';

export function deduplicationMiddleware(supabase: SupabaseClient<Database>): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const updateId = ctx.update.update_id;
    if (!updateId) {
      return next();
    }

    try {
      // Try to insert update_id into processed_updates
      const { error } = await (supabase as any)
        .from('processed_updates')
        .insert({ update_id: updateId });

      if (error) {
        // Code 23505 is PostgreSQL unique constraint violation
        if (error.code === '23505' || error.message.includes('duplicate key')) {
          logger.warn({ updateId }, 'Duplicate Telegram update received, dropping');
          return;
        }
        logger.error({ error, updateId }, 'Failed to record processed update');
      }
    } catch (err) {
      logger.error({ err, updateId }, 'Exception in deduplication check');
    }

    await next();
  };
}

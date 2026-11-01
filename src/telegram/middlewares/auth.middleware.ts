import { Context, MiddlewareFn } from 'grammy';
import { AuthService, UserRecord } from '../../modules/auth/auth.service.js';
import { logger } from '../../config/logger.js';

export interface AppContext extends Context {
  dbUser?: UserRecord;
}

export function authMiddleware(authService: AuthService): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (!from) {
      return;
    }

    try {
      const dbUser = await authService.getOrCreateUser(from);
      if (!dbUser) {
        logger.warn({ telegramId: from.id, username: from.username }, 'Access denied: user not whitelisted');
        await ctx.reply(
          '⛔ *Akses Ditolak*\n\nBot ini adalah asisten produk pribadi yang terproteksi. Telegram ID Anda belum terdaftar dalam whitelist.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      ctx.dbUser = dbUser;
      await next();
    } catch (error) {
      logger.error({ error, fromId: from.id }, 'Auth middleware failure');
      await ctx.reply('⚠️ Terjadi kendala saat memeriksa otorisasi. Silakan coba kembali nanti.');
    }
  };
}


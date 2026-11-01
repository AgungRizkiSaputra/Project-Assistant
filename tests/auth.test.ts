import { describe, it, expect, vi } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service.js';

describe('AuthService', () => {
  const allowedIds = [111, 222];

  it('correctly checks if telegram ID is whitelisted', () => {
    const authService = new AuthService({} as any, allowedIds);
    expect(authService.isUserAllowed(111)).toBe(true);
    expect(authService.isUserAllowed(222)).toBe(true);
    expect(authService.isUserAllowed(999)).toBe(false);
  });

  it('returns null and does not query DB if user is not allowed', async () => {
    const mockSupabase = {
      from: vi.fn(),
    };
    const authService = new AuthService(mockSupabase as any, allowedIds);
    const result = await authService.getOrCreateUser({ id: 999 });

    expect(result).toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});


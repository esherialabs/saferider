import { describe, expect, it, vi } from 'vitest';

import { resolveAuthorizedChatRoom, resolveChatRoomToLeave } from '../chatRoomAuthorization.js';

const OWNED_SESSION = '11111111-1111-4111-8111-111111111111';
const FOREIGN_SESSION = '22222222-2222-4222-8222-222222222222';

describe('WebSocket chat room authorization', () => {
  it('allows the authenticated owner to resolve their session room', async () => {
    const lookup = vi.fn().mockResolvedValue(true);

    await expect(
      resolveAuthorizedChatRoom('owner-a', { sessionId: OWNED_SESSION }, lookup),
    ).resolves.toBe(`chat:${OWNED_SESSION}`);
    expect(lookup).toHaveBeenCalledWith('owner-a', OWNED_SESSION);
  });

  it('does not resolve a room owned by another account', async () => {
    const lookup = vi.fn().mockResolvedValue(false);

    await expect(
      resolveAuthorizedChatRoom('owner-a', { sessionId: FOREIGN_SESSION }, lookup),
    ).resolves.toBeNull();
    expect(lookup).toHaveBeenCalledWith('owner-a', FOREIGN_SESSION);
  });

  it.each([undefined, null, {}, { sessionId: 'not-a-uuid' }])(
    'rejects malformed room requests without querying ownership: %j',
    async payload => {
      const lookup = vi.fn();
      await expect(resolveAuthorizedChatRoom('owner-a', payload, lookup)).resolves.toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('only derives leave targets from syntactically valid session IDs', () => {
    expect(resolveChatRoomToLeave({ sessionId: OWNED_SESSION })).toBe(`chat:${OWNED_SESSION}`);
    expect(resolveChatRoomToLeave({ sessionId: '../foreign' })).toBeNull();
  });
});

import { z } from 'zod';

const chatJoinPayloadSchema = z.object({
  sessionId: z.string().uuid(),
});

type OwnershipLookup = (ownerId: string, sessionId: string) => Promise<boolean>;

export async function resolveAuthorizedChatRoom(
  ownerId: string,
  payload: unknown,
  lookupOwnership: OwnershipLookup,
): Promise<string | null> {
  const parsed = chatJoinPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;

  const owned = await lookupOwnership(ownerId, parsed.data.sessionId);
  return owned ? `chat:${parsed.data.sessionId}` : null;
}

export function resolveChatRoomToLeave(payload: unknown): string | null {
  const parsed = chatJoinPayloadSchema.safeParse(payload);
  return parsed.success ? `chat:${parsed.data.sessionId}` : null;
}

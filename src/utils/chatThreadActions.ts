export type ChatThreadActionMessage = {
  id: string;
  role: 'user' | 'assistant';
};

function isWelcomeMessage(message: ChatThreadActionMessage): boolean {
  return message.id.endsWith('-welcome');
}

export function findPreviousUserMessage<T extends ChatThreadActionMessage>(
  messages: T[],
  startIndex: number,
): T | null {
  for (let index = startIndex; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }

  return null;
}

export function getLastAssistantActionMessageId(messages: ChatThreadActionMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isWelcomeMessage(message)) continue;
    return message.role === 'assistant' ? message.id : null;
  }

  return null;
}

export function getLastEditableUserMessageId(messages: ChatThreadActionMessage[]): string | null {
  const lastAssistantId = getLastAssistantActionMessageId(messages);
  const lastAssistantIndex = lastAssistantId
    ? messages.findIndex(message => message.id === lastAssistantId)
    : messages.length;
  const previousUser = findPreviousUserMessage(messages, lastAssistantIndex - 1);
  if (previousUser) {
    return previousUser.id;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && !isWelcomeMessage(message) && message.role === 'user') {
      return message.id;
    }
  }

  return null;
}

export function formatRemainingDownloadTime(seconds: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  if (seconds < 60) {
    return 'less than 1 min left';
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min left`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hr left`;
  }
  return `${hours} hr ${remainingMinutes} min left`;
}

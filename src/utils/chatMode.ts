export type ChatAssistantState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'configuring'
  | 'ready'
  | 'error';

export type LegalAidChatModeId =
  | 'chat-unavailable'
  | 'offline-queued'
  | 'local-assistant'
  | 'local-assistant-preparing'
  | 'local-assistant-downloaded'
  | 'local-assistant-setup'
  | 'stored-history'
  | 'local-guidance-unavailable';

export type ChatModeTone = 'success' | 'warning' | 'offline' | 'neutral' | 'error';

export type ChatModeRow = {
  label: string;
  value: string;
  detail: string;
  tone: ChatModeTone;
};

export type LegalAidChatMode = {
  id: LegalAidChatModeId;
  title: string;
  badge: string;
  description: string;
  rows: ChatModeRow[];
};

export type LegalAidChatModeInput = {
  isOnline: boolean;
  hasSession: boolean;
  sessionLocalOnly?: boolean;
  hasStoredHistory: boolean;
  queuedMessageCount?: number;
  localAssistantEnabled: boolean;
  localAssistantState: ChatAssistantState;
  localAssistantProgress?: number;
  localAssistantResumable?: boolean;
  providerReferralAvailable?: boolean;
};

export const CHAT_PROVIDER_REFERRAL_AVAILABLE = false;

function normaliseQueueCount(count: number | undefined): number {
  if (!Number.isFinite(count ?? 0)) return 0;
  return Math.max(0, Math.floor(count ?? 0));
}

function pluraliseMessage(count: number): string {
  return count === 1 ? '1 message' : `${count} messages`;
}

function getAssistantRow(input: LegalAidChatModeInput): ChatModeRow {
  if (input.localAssistantEnabled && input.localAssistantState === 'ready') {
    return {
      label: 'Assistant',
      value: 'Local AI ready',
      detail: 'Replies stay on this phone.',
      tone: 'success',
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'downloading') {
    return {
      label: 'Assistant',
      value: 'Downloading model',
      detail: 'Keep SafeRide open. Progress saves.',
      tone: 'warning',
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'checking') {
    return {
      label: 'Assistant',
      value: 'Checking saved model',
      detail: 'SafeRide is checking local app storage.',
      tone: 'warning',
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'verifying') {
    return {
      label: 'Assistant',
      value: 'Verifying model',
      detail: `Checking file integrity${typeof input.localAssistantProgress === 'number' ? ` - ${input.localAssistantProgress}%` : ''}.`,
      tone: 'warning',
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'configuring') {
    return {
      label: 'Assistant',
      value: 'Starting model',
      detail: 'SafeRide is checking the model.',
      tone: 'warning',
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'downloaded') {
    return {
      label: 'Assistant',
      value: 'Model saved',
      detail: 'SafeRide is loading it automatically.',
      tone: 'warning',
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'error') {
    if (input.localAssistantResumable || (input.localAssistantProgress ?? 0) > 0) {
      return {
        label: 'Assistant',
        value: 'Resuming local model',
        detail: 'Saved progress resumes while SafeRide is open.',
        tone: 'warning',
      };
    }

    return {
      label: 'Assistant',
      value: 'Local model unavailable',
      detail: 'Try setup again.',
      tone: 'error',
    };
  }

  if (input.localAssistantEnabled) {
    return {
      label: 'Assistant',
      value: 'Initializing local AI',
      detail: 'SafeRide downloads once while this chat is open.',
      tone: 'neutral',
    };
  }

  return {
    label: 'Assistant',
    value: 'Local model disabled',
    detail: 'Chat can still save history and show basic support information.',
    tone: 'neutral',
  };
}

function getHistoryRow(input: LegalAidChatModeInput): ChatModeRow {
  if (input.sessionLocalOnly) {
    return {
      label: 'History',
      value: 'Local phone session',
      detail: 'This conversation is saved on this phone.',
      tone: 'warning',
    };
  }

  if (!input.hasSession) {
    return {
      label: 'History',
      value: 'Unavailable',
      detail: 'Chat history could not be loaded or created.',
      tone: 'error',
    };
  }

  if (input.hasStoredHistory) {
    return {
      label: 'History',
      value: 'Stored conversation history',
      detail: 'Previous messages are shown where available.',
      tone: 'neutral',
    };
  }

  return {
    label: 'History',
    value: 'New conversation',
    detail: 'Messages appear here after saving.',
    tone: 'neutral',
  };
}

function getDeliveryRow(input: LegalAidChatModeInput, queuedMessageCount: number): ChatModeRow {
  if (input.sessionLocalOnly) {
    return {
      label: 'Delivery',
      value: 'Local phone save',
      detail: 'Messages stay on this device.',
      tone: 'offline',
    };
  }

  if (!input.hasSession) {
    return {
      label: 'Delivery',
      value: 'Not available',
      detail: 'Messages cannot be sent until chat history is available.',
      tone: 'error',
    };
  }

  if (!input.isOnline && queuedMessageCount > 0) {
    return {
      label: 'Delivery',
      value: `${pluraliseMessage(queuedMessageCount)} queued`,
      detail: 'They may sync to chat history after reconnection.',
      tone: 'offline',
    };
  }

  if (!input.isOnline) {
    return {
      label: 'Delivery',
      value: 'Offline local save',
      detail: 'New messages stay on this device.',
      tone: 'offline',
    };
  }

  return {
    label: 'Delivery',
    value: 'Online history save',
    detail: 'Messages save to chat history.',
    tone: 'success',
  };
}

function getProviderRow(input: LegalAidChatModeInput): ChatModeRow {
  if (input.providerReferralAvailable) {
    return {
      label: 'Provider',
      value: 'Referral available',
      detail: 'Consent is required before a referral brief leaves.',
      tone: 'success',
    };
  }

  return {
    label: 'Provider',
    value: 'Not active in chat',
    detail: 'Use referral flow for provider options.',
    tone: 'neutral',
  };
}

export function deriveLegalAidChatMode(input: LegalAidChatModeInput): LegalAidChatMode {
  const queuedMessageCount = normaliseQueueCount(input.queuedMessageCount);
  const rows = [
    getAssistantRow(input),
    getHistoryRow(input),
    getDeliveryRow(input, queuedMessageCount),
    getProviderRow(input),
  ];

  if (!input.hasSession) {
    return {
      id: 'chat-unavailable',
      title: 'Chat history unavailable',
      badge: 'Unavailable',
      description: 'SafeRide could not load or create a chat session.',
      rows,
    };
  }

  if (!input.isOnline && queuedMessageCount > 0) {
    return {
      id: 'offline-queued',
      title: 'Offline saved chat',
      badge: 'Queued locally',
      description: 'Queued messages are saved on this device. No provider has received them from chat.',
      rows,
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'ready') {
    return {
      id: 'local-assistant',
      title: 'Local AI assistant mode',
      badge: 'Local',
      description: 'On-device support suggestions are ready. It is not a lawyer, clinician, counsellor, or provider.',
      rows,
    };
  }

  if (
    input.localAssistantEnabled
    && (
      input.localAssistantState === 'checking'
      || input.localAssistantState === 'downloading'
      || input.localAssistantState === 'verifying'
    )
  ) {
    return {
      id: 'local-assistant-preparing',
      title: 'Local model preparing',
      badge: 'Preparing',
      description: 'Local model setup is in progress.',
      rows,
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'configuring') {
    return {
      id: 'local-assistant-preparing',
      title: 'Local model configuring',
      badge: 'Configuring',
      description: 'SafeRide is checking the model.',
      rows,
    };
  }

  if (
    input.localAssistantEnabled &&
    input.localAssistantState === 'error' &&
    (input.localAssistantResumable || (input.localAssistantProgress ?? 0) > 0)
  ) {
    return {
      id: 'local-assistant-setup',
      title: 'Resuming local model',
      badge: 'Preparing',
      description: 'Saved download progress is available and resumes while SafeRide is open.',
      rows,
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'downloaded') {
    return {
      id: 'local-assistant-downloaded',
      title: 'Model saved',
      badge: 'Loading',
      description: 'SafeRide is loading the saved model for local replies.',
      rows,
    };
  }

  if (input.hasStoredHistory) {
    return {
      id: 'stored-history',
      title: 'Stored conversation history',
      badge: 'History',
      description: 'Chat history is available; the phone-local assistant is not ready.',
      rows,
    };
  }

  if (input.localAssistantEnabled && input.localAssistantState === 'idle') {
    return {
      id: 'local-assistant-setup',
      title: 'Initializing local AI',
      badge: 'Initializing',
      description: 'SafeRide is preparing local replies while this chat is open.',
      rows,
    };
  }

  return {
    id: 'local-guidance-unavailable',
    title: input.localAssistantEnabled ? 'Local AI needs attention' : 'Local assistant off',
    badge: 'Guidance only',
    description: input.localAssistantEnabled
      ? 'Try setup again.'
      : 'On-phone assistant replies are disabled in this build.',
    rows,
  };
}

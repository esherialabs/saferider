import { Alert, AlertButton } from 'react-native';

import { encryptedAsyncStorage } from '../lib/encryptedAsyncStorage';
import NetInfoShim from './netinfoShim';
import { getOfflineChatResponseCopy } from '../i18n/appLanguage';
import { devPrivacyError, devPrivacyInfo, devPrivacyWarn, getPrivacySafeErrorReason } from './privacyLog';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: ChatAttachment[];
  sources?: string[];
  isOffline?: boolean;
  deliveryStatus?: 'queued' | 'local-only' | 'sent' | 'failed';
  error?: string;
  retryCount?: number;
}

export interface ChatAttachment {
  id: string;
  uri: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  localOnly?: boolean;
}

export interface PersistableChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date | string;
  attachments?: ChatAttachment[];
  sources?: string[];
  isOffline?: boolean;
  deliveryStatus?: ChatMessage['deliveryStatus'];
}

export interface ChatError {
  type: 'network' | 'storage' | 'processing' | 'timeout';
  message: string;
  recoverable: boolean;
  retryable: boolean;
}

export class ChatErrorHandler {
  private static readonly STORAGE_KEY = 'chat_messages';
  private static readonly RETRY_QUEUE_KEY = 'message_retry_queue';
  private static readonly MAX_RETRY_COUNT = 3;
  private static readonly TIMEOUT_MS = 10000;

  private static storageKey(sessionId: string): string {
    return `${this.STORAGE_KEY}:${sessionId}`;
  }

  private static retryQueueKey(sessionId: string): string {
    return `${this.RETRY_QUEUE_KEY}:${sessionId}`;
  }

  private static serializeTimestamp(value: Date | string): string {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  static serializeMessagesForOffline(messages: PersistableChatMessage[]): ChatMessage[] {
    return messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: this.serializeTimestamp(message.createdAt),
      attachments: message.attachments,
      sources: message.sources,
      isOffline: message.isOffline,
      deliveryStatus: message.deliveryStatus,
    }));
  }

  static async persistMessageSnapshot(
    sessionId: string,
    messages: PersistableChatMessage[],
  ): Promise<boolean> {
    return this.saveMessagesOffline(sessionId, this.serializeMessagesForOffline(messages));
  }

  static async saveMessagesOffline(sessionId: string, messages: ChatMessage[]): Promise<boolean> {
    try {
      const storageKey = this.storageKey(sessionId);
      await encryptedAsyncStorage.setItem(storageKey, JSON.stringify(messages));
      // Clean up legacy key used before per-session storage
      await encryptedAsyncStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      devPrivacyError('offline chat message save failed', { reason: getPrivacySafeErrorReason(error) });
      return false;
    }
  }

  static async loadMessagesOffline(sessionId: string): Promise<ChatMessage[]> {
    try {
      const storageKey = this.storageKey(sessionId);
      let stored = await encryptedAsyncStorage.getItem(storageKey);

      // Migrate legacy storage if present (pre per-session storage)
      if (!stored) {
        stored = await encryptedAsyncStorage.getItem(this.STORAGE_KEY);
        if (stored) {
          await encryptedAsyncStorage.setItem(storageKey, stored);
          await encryptedAsyncStorage.removeItem(this.STORAGE_KEY);
        }
      }

      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      await encryptedAsyncStorage.removeItem(this.storageKey(sessionId));
      await encryptedAsyncStorage.removeItem(this.STORAGE_KEY);
      devPrivacyInfo('offline chat message cache reset', { reason: getPrivacySafeErrorReason(error) });
      return [];
    }
  }

  static async clearOfflineMessages(sessionId: string): Promise<void> {
    try {
      await encryptedAsyncStorage.removeItem(this.storageKey(sessionId));
      // Remove legacy key if it still exists
      await encryptedAsyncStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      devPrivacyError('offline chat message clear failed', { reason: getPrivacySafeErrorReason(error) });
    }
  }

  static handleError(error: any): ChatError {
    if (!error) {
      return {
        type: 'processing',
        message: 'SafeRide could not finish that chat action. Your message can stay on this phone.',
        recoverable: false,
        retryable: false
      };
    }

    // Network errors
    if (error.name === 'NetworkError' || error.message?.includes('network')) {
      return {
        type: 'network',
        message: 'SafeRide is still connecting. Your chat stays on this phone until the connection is stable.',
        recoverable: true,
        retryable: true
      };
    }

    // Timeout errors
    if (error.name === 'TimeoutError' || error.code === 'TIMEOUT') {
      return {
        type: 'timeout',
        message: 'SafeRide is still connecting. Your message stays on this phone; retry when the connection is stable.',
        recoverable: true,
        retryable: true
      };
    }

    // Storage errors
    if (error.message?.includes('storage') || error.message?.includes('quota')) {
      return {
        type: 'storage',
        message: 'Storage error. Please free up space and try again.',
        recoverable: true,
        retryable: false
      };
    }

    // Processing errors
    return {
      type: 'processing',
      message: 'SafeRide could not finish that chat action. Your message can stay on this phone.',
      recoverable: false,
      retryable: true
    };
  }

  static showErrorAlert(error: ChatError, onRetry?: () => void): void {
    const buttons: AlertButton[] = [{ text: 'OK', style: 'cancel' }];
    
    if (error.retryable && onRetry) {
      buttons.unshift({ text: 'Retry', onPress: onRetry });
    }

    Alert.alert('Chat Error', error.message, buttons);
  }

  static async retryMessage(
    message: ChatMessage,
    sendFunction: (content: string) => Promise<void>
  ): Promise<boolean> {
    const retryCount = (message.retryCount || 0) + 1;
    
    if (retryCount > this.MAX_RETRY_COUNT) {
      return false;
    }

    try {
      await sendFunction(message.content);
      return true;
    } catch (error) {
      devPrivacyWarn('chat retry failed', {
        reason: getPrivacySafeErrorReason(error),
        retryCount,
      });
      message.retryCount = retryCount;
      return false;
    }
  }

  static async isOnline(): Promise<boolean> {
    try {
      const state: any = await NetInfoShim.fetch();
      if (typeof state?.isInternetReachable === 'boolean') {
        return state.isInternetReachable;
      }
      if (typeof state?.isConnected === 'boolean') {
        return state.isConnected;
      }
      return false;
    } catch (error) {
      devPrivacyWarn('chat network reachability check failed', { reason: getPrivacySafeErrorReason(error) });
      return false;
    }
  }

  static generateOfflineResponse(userMessage: string, languageCode?: string | null): ChatMessage {
    const copy = getOfflineChatResponseCopy(languageCode);
    let offlineResponse = copy.default;
    const normalizedMessage = userMessage.trim().toLowerCase();

    if (/^(hi|hello|hey|mambo|sasa|habari)\b/.test(normalizedMessage)) {
      offlineResponse = copy.greeting;
    } else if (
      normalizedMessage.includes('report') ||
      normalizedMessage.includes('police') ||
      normalizedMessage.includes('ripoti') ||
      normalizedMessage.includes('polisi')
    ) {
      offlineResponse = copy.reporting;
    } else if (
      normalizedMessage.includes('medical') ||
      normalizedMessage.includes('pep') ||
      normalizedMessage.includes('matibabu') ||
      normalizedMessage.includes('afya')
    ) {
      offlineResponse = copy.medical;
    } else if (
      normalizedMessage.includes('help') ||
      normalizedMessage.includes('support') ||
      normalizedMessage.includes('msaada') ||
      normalizedMessage.includes('saidizi')
    ) {
      offlineResponse = copy.support;
    }

    return {
      id: Date.now().toString(),
      role: 'assistant',
      content: offlineResponse,
      timestamp: new Date().toISOString(),
      isOffline: true,
      sources: [...copy.sources],
    };
  }

  static async queueMessageForRetry(sessionId: string, message: ChatMessage): Promise<boolean> {
    try {
      const queueKey = this.retryQueueKey(sessionId);
      let queueData = await encryptedAsyncStorage.getItem(queueKey);

      // Migrate legacy queue storage if present
      if (!queueData) {
        queueData = await encryptedAsyncStorage.getItem(this.RETRY_QUEUE_KEY);
        if (queueData) {
          await encryptedAsyncStorage.removeItem(this.RETRY_QUEUE_KEY);
        }
      }

      const queue = queueData ? JSON.parse(queueData) : [];
      
      queue.push({
        ...message,
        queuedAt: Date.now(),
        retryCount: (message.retryCount || 0) + 1,
        sessionId,
      });
      
      await encryptedAsyncStorage.setItem(queueKey, JSON.stringify(queue));
      return true;
    } catch (error) {
      devPrivacyError('chat retry queue save failed', { reason: getPrivacySafeErrorReason(error) });
      return false;
    }
  }

  static async clearRetryQueue(sessionId: string): Promise<void> {
    try {
      await encryptedAsyncStorage.removeItem(this.retryQueueKey(sessionId));
      await encryptedAsyncStorage.removeItem(this.RETRY_QUEUE_KEY);
    } catch (error) {
      devPrivacyError('chat retry queue clear failed', { reason: getPrivacySafeErrorReason(error) });
    }
  }

  static async getRetryQueueCount(sessionId: string): Promise<number> {
    try {
      const queueKey = this.retryQueueKey(sessionId);
      let queueData = await encryptedAsyncStorage.getItem(queueKey);

      if (!queueData) {
        queueData = await encryptedAsyncStorage.getItem(this.RETRY_QUEUE_KEY);
      }

      if (!queueData) return 0;

      const queue: Array<ChatMessage & { sessionId?: string }> = JSON.parse(queueData);
      return queue.filter(message => (message.sessionId ?? sessionId) === sessionId).length;
    } catch (error) {
      devPrivacyError('chat retry queue count failed', { reason: getPrivacySafeErrorReason(error) });
      return 0;
    }
  }

  static async processRetryQueue(
    sessionId: string,
    sendFunction: (content: string) => Promise<void>
  ): Promise<number> {
    try {
      const queueKey = this.retryQueueKey(sessionId);
      let queueData = await encryptedAsyncStorage.getItem(queueKey);

      // Migrate legacy storage if present
      if (!queueData) {
        queueData = await encryptedAsyncStorage.getItem(this.RETRY_QUEUE_KEY);
        if (queueData) {
          await encryptedAsyncStorage.removeItem(this.RETRY_QUEUE_KEY);
          await encryptedAsyncStorage.setItem(queueKey, queueData);
        }
      }
      
      if (!queueData) return 0;
      
      const queue: Array<ChatMessage & { sessionId?: string }> = JSON.parse(queueData);
      const remaining: Array<ChatMessage & { sessionId?: string }> = [];
      let successCount = 0;

      for (const message of queue) {
        const targetSessionId = message.sessionId ?? sessionId;
        if (targetSessionId !== sessionId) {
          remaining.push(message);
          continue;
        }

        try {
          await sendFunction(message.content);
          successCount++;
        } catch (error) {
          if ((message.retryCount || 0) < this.MAX_RETRY_COUNT) {
            remaining.push({
              ...message,
              sessionId: sessionId,
              retryCount: (message.retryCount || 0) + 1
            });
          }
        }
      }

      // Update queue with messages that still need to be retried (for this or other sessions)
      await encryptedAsyncStorage.setItem(queueKey, JSON.stringify(remaining));
      
      return successCount;
    } catch (error) {
      devPrivacyError('chat retry queue processing failed', { reason: getPrivacySafeErrorReason(error) });
      return 0;
    }
  }
}

export default ChatErrorHandler;

import { devPrivacyInfo } from './privacyLog';

export type NotifyVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface NotifyPayload {
  title: string;
  message?: string;
  variant?: NotifyVariant;
}

type NotifyHandler = (payload: NotifyPayload) => void;

class NotificationCenter {
  private handler: NotifyHandler | null = null;

  setHandler(handler: NotifyHandler) {
    this.handler = handler;
  }

  clearHandler() {
    this.handler = null;
  }

  notify(payload: NotifyPayload) {
    if (this.handler) {
      this.handler(payload);
    } else {
      devPrivacyInfo('notification emitted without UI handler', {
        variant: payload.variant ?? 'default',
      });
    }
  }
}

export const notificationCenter = new NotificationCenter();


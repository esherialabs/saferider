export type ConfirmRole = 'primary' | 'secondary' | 'destructive' | 'cancel';

export interface ConfirmAction {
  id: string;
  label: string;
  role?: ConfirmRole;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  actions: ConfirmAction[]; // Rendered left→right in order
}

type ConfirmHandler = (options: ConfirmOptions, resolve: (actionId: string) => void) => void;

class ConfirmCenter {
  private handler: ConfirmHandler | null = null;

  setHandler(handler: ConfirmHandler) {
    this.handler = handler;
  }

  clearHandler() {
    this.handler = null;
  }

  request(options: ConfirmOptions): Promise<string> {
    return new Promise((resolve) => {
      if (this.handler) {
        this.handler(options, resolve);
      } else {
        // Fallback: resolve with the primary/cancel/first action
        const primary = options.actions.find(a => a.role === 'primary');
        const cancel = options.actions.find(a => a.role === 'cancel');
        resolve((primary || cancel || options.actions[0] || { id: 'ok' }).id);
      }
    });
  }
}

export const confirmCenter = new ConfirmCenter();


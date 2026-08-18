import React from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './Dialog';
import { confirmCenter, ConfirmOptions, ConfirmAction } from '../../utils/confirmCenter';
import Button from './Button';

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (actionId: string) => void;
}

export default function GlobalConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    confirmCenter.setHandler((options, resolve) => {
      setPending({ options, resolve });
    });
    return () => confirmCenter.clearHandler();
  }, []);

  if (!pending) return null;

  const { options, resolve } = pending;

  const onAction = (action: ConfirmAction) => {
    resolve(action.id);
    setPending(null);
  };

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open && pending) {
          // Treat dismiss as cancel if available, else first action
          const cancel = options.actions.find((a) => a.role === 'cancel');
          resolve((cancel || options.actions[0]).id);
          setPending(null);
        }
      }}
    >
      <DialogContent showCloseButton={false} style={{ paddingBottom: 0 }}>
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          {options.message && <DialogDescription>{options.message}</DialogDescription>}
        </DialogHeader>
        <DialogFooter style={{ justifyContent: 'flex-end' }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {options.actions.map((action) => (
              <Button
                key={action.id}
                title={action.label}
                variant={mapRoleToVariant(action.role)}
                onPress={() => onAction(action)}
              />
            ))}
          </View>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function mapRoleToVariant(role?: 'primary' | 'secondary' | 'destructive' | 'cancel') {
  switch (role) {
    case 'destructive':
      return 'destructive';
    case 'secondary':
      return 'secondary';
    case 'cancel':
      return 'ghost';
    case 'primary':
    default:
      return 'primary';
  }
}

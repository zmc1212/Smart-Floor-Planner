'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
} from 'react';
import { App } from 'antd';

type ConfirmOptions = {
  title?: ReactNode;
  description: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  destructive?: boolean;
  /** Raise above nested drawers/modals when needed. */
  zIndex?: number;
};

type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmAction | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { modal } = App.useApp();

  const confirmAction = useCallback<ConfirmAction>((options) => {
    return new Promise((resolve) => {
      modal.confirm({
        title: options.title || '确认操作',
        content: options.description,
        okText: options.confirmText || '确认',
        cancelText: options.cancelText || '取消',
        okButtonProps: options.destructive ? { danger: true } : undefined,
        centered: true,
        ...(typeof options.zIndex === 'number' ? { zIndex: options.zIndex } : {}),
        onOk: () => {
          resolve(true);
        },
        onCancel: () => {
          resolve(false);
        },
      });
    });
  }, [modal]);

  return (
    <ConfirmDialogContext.Provider value={confirmAction}>
      {children}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const confirmAction = useContext(ConfirmDialogContext);

  return useCallback<ConfirmAction>(
    async (options) => {
      if (confirmAction) return confirmAction(options);
      console.warn('ConfirmDialogProvider is missing.', options);
      return false;
    },
    [confirmAction]
  );
}

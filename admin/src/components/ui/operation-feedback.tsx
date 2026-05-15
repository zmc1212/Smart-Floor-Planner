'use client';

import { Toaster, toast, type ExternalToast } from 'sonner';
import type { ReactNode } from 'react';

type FeedbackMessage = string | ReactNode;
type FeedbackOptions = ExternalToast;

function normalizeMessage(message: unknown): string {
  if (message === null || message === undefined) return '操作已完成';
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  return String(message);
}

function getAlertVariant(message: unknown) {
  const text = normalizeMessage(message);
  if (/成功|已完成|已保存|已创建|已更新|已删除|已重置|已同步|已发放|已开通|已认领|已分配/.test(text)) {
    return 'success';
  }
  if (/失败|错误|异常|不能|无法|请|缺少|超出|无效|未找到|Forbidden|Unauthorized/i.test(text)) {
    return 'error';
  }
  return 'info';
}

export function OperationFeedbackToaster() {
  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        duration: 3000,
      }}
    />
  );
}

export const notify = {
  success(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.success(message, options);
  },
  error(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.error(message, options);
  },
  info(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.info(message, options);
  },
  warning(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.warning(message, options);
  },
  loading(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.loading(message, options);
  },
  dismiss(toastId?: string | number) {
    toast.dismiss(toastId);
  },
  promise: toast.promise,
  fromAlert(message: unknown, options?: FeedbackOptions) {
    const text = normalizeMessage(message);
    const variant = getAlertVariant(text);
    return notify[variant](text, options);
  },
};

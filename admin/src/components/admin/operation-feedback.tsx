'use client';

import { Toaster, toast, type ExternalToast } from 'sonner';
import type { ReactNode } from 'react';

type FeedbackMessage = string | ReactNode;
type FeedbackOptions = ExternalToast;

const FEEDBACK_MESSAGE_TRANSLATIONS: Record<string, string> = {
  Unauthorized: '登录状态已失效，请重新登录',
  Forbidden: '您暂无权限执行此操作',
  'Not found': '未找到对应数据',
  'Internal Server Error': '服务暂时不可用，请稍后重试',
  'Missing required fields': '请填写必填项',
  'Missing recordId': '缺少报备记录标识',
  'Missing layoutData': '缺少户型数据',
  'Missing generationId': '缺少生成任务标识',
  'Missing actionName': '缺少操作名称',
  'Missing stageKey': '缺少工作流阶段标识',
  'Missing url': '缺少图片地址',
  'Missing coordinates': '缺少坐标信息',
  'Invalid request': '请求参数无效',
  'Invalid messages': '消息内容无效',
  'Invalid status': '状态值无效',
  'Invalid token': '登录凭证无效，请重新登录',
  'Invalid login method': '登录方式无效',
  'Unsupported action': '不支持此操作',
  'Unsupported actionName': '不支持此操作',
  'Unsupported protocol': '不支持此链接协议',
  'Enterprise context required': '请先选择企业',
  'Enterprise required': '需要企业上下文',
  'Unable to determine enterprise': '无法确定所属企业',
  'Provider not found': '未找到 AI 供应商',
  'Preset not found': '未找到 AI 预设',
  'Task not found': '未找到任务',
  'Conversation not found': '未找到会话',
  'Floor plan not found': '未找到户型图',
  'Lead not found or access denied': '未找到线索或您无权访问',
  'Staff profile not found': '未找到员工资料',
  'Record not found': '未找到报备记录',
  'Asset not found': '未找到资源',
  'Generation image not found': '未找到生成图片',
  'Failed to load workflow leads': '读取工作流线索失败',
  'Failed to load AI presets': '读取 AI 预设失败',
  'Failed to update AI preset': '更新 AI 预设失败',
  'Failed to load prompt templates': '读取提示词模板失败',
  'Failed to load prompt categories': '读取提示词分类失败',
  'Failed to load prompt template': '读取提示词模板失败',
  'Failed to load prompt preview': '读取提示词预览失败',
  'Failed to load image asset': '读取图片资源失败',
  'Failed to fetch image': '获取图片失败',
  'Image proxy failed': '图片代理请求失败',
};

function localizeFeedbackMessage(message: FeedbackMessage): FeedbackMessage {
  if (typeof message !== 'string') return message;
  const translated = FEEDBACK_MESSAGE_TRANSLATIONS[message];
  if (translated) return translated;
  return /^[\x00-\x7F]+$/.test(message) && /[A-Za-z]/.test(message)
    ? '操作失败，请稍后重试'
    : message;
}

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
    return toast.success(localizeFeedbackMessage(message), options);
  },
  error(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.error(localizeFeedbackMessage(message), options);
  },
  info(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.info(localizeFeedbackMessage(message), options);
  },
  warning(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.warning(localizeFeedbackMessage(message), options);
  },
  loading(message: FeedbackMessage, options?: FeedbackOptions) {
    return toast.loading(localizeFeedbackMessage(message), options);
  },
  dismiss(toastId?: string | number) {
    toast.dismiss(toastId);
  },
  promise: toast.promise,
  fromAlert(message: unknown, options?: FeedbackOptions) {
    const text = normalizeMessage(localizeFeedbackMessage(message as FeedbackMessage));
    const variant = getAlertVariant(text);
    return notify[variant](text, options);
  },
};

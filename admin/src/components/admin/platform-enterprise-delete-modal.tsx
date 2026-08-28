'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Flex, Input, Modal, Typography } from 'antd';
import { useAccountSettings } from '@/components/admin/account-settings-provider';
import { notify } from '@/components/admin/operation-feedback';
import {
  PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT,
  PLATFORM_ENTERPRISE_BATCH_PURGE_MAX,
} from '@/lib/platform-enterprise-purge-contract';
import { PLATFORM_SENSITIVE_PASSWORD_API } from '@/lib/sensitive-password-access';

export type PlatformEnterpriseDeleteTarget = {
  _id: string;
  name: string;
};

type PlatformEnterpriseDeleteModalProps = {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
} & (
  | { mode: 'single'; enterprise: PlatformEnterpriseDeleteTarget | null }
  | { mode: 'batch'; enterprises: PlatformEnterpriseDeleteTarget[] }
);

type BatchPurgeResult = {
  deleted?: Array<{ id: string; name: string; totalRows: number }>;
  failed?: Array<{ id: string; error: string; code?: string }>;
};

function isSensitivePasswordNotConfigured(payload: {
  code?: string;
  error?: string;
} | null) {
  return (
    payload?.code === 'sensitive_password_not_configured' ||
    payload?.error === '请先设置安全密码'
  );
}

export function PlatformEnterpriseDeleteModal(
  props: PlatformEnterpriseDeleteModalProps
) {
  const { open, onClose, onDeleted } = props;
  const { openSensitivePassword } = useAccountSettings();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');

  const enterprises = props.mode === 'batch' ? props.enterprises : [];
  const enterprise = props.mode === 'single' ? props.enterprise : null;
  const batchCount = enterprises.length;
  const batchOverLimit = batchCount > PLATFORM_ENTERPRISE_BATCH_PURGE_MAX;

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const response = await fetch(PLATFORM_SENSITIVE_PASSWORD_API);
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '读取安全密码状态失败');
      }
      setConfigured(Boolean(payload.data?.configured));
    } catch (error) {
      setConfigured(null);
      notify.error(
        error instanceof Error ? error.message : '读取安全密码状态失败'
      );
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setConfirmName('');
      setConfirmText('');
      setPassword('');
      setConfigured(null);
      return;
    }
    void loadStatus();
  }, [open, loadStatus]);

  const canSubmit = useMemo(() => {
    if (configured !== true || loadingStatus || submitting) return false;
    if (props.mode === 'single') {
      return Boolean(
        enterprise &&
          confirmName.trim() === enterprise.name &&
          password.trim()
      );
    }
    return (
      batchCount >= 1 &&
      !batchOverLimit &&
      confirmText.trim() === PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT &&
      Boolean(password.trim())
    );
  }, [
    batchCount,
    batchOverLimit,
    confirmName,
    confirmText,
    configured,
    enterprise,
    loadingStatus,
    password,
    props.mode,
    submitting,
  ]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (props.mode === 'single') {
        if (!enterprise) return;
        const response = await fetch(
          `/api/admin/enterprises/${enterprise._id}`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              confirmEnterpriseName: confirmName.trim(),
              securityPassword: password.trim(),
            }),
          }
        );
        const payload = await response.json().catch(() => null);
        if (isSensitivePasswordNotConfigured(payload)) {
          setConfigured(false);
          notify.error(payload?.error || '请先设置安全密码');
          return;
        }
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || '删除企业失败');
        }
        notify.success(payload.message || '企业已删除');
        await onDeleted();
        onClose();
        return;
      }

      const response = await fetch('/api/admin/enterprises', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: enterprises.map((item) => item._id),
          confirmText: confirmText.trim(),
          securityPassword: password.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (isSensitivePasswordNotConfigured(payload)) {
        setConfigured(false);
        notify.error(payload?.error || '请先设置安全密码');
        return;
      }

      const data = (payload?.data || {}) as BatchPurgeResult;
      const deleted = data.deleted || [];
      const failed = data.failed || [];
      if (deleted.length && failed.length) {
        notify.warning(
          `已删除 ${deleted.length} 家，${failed.length} 家失败：${failed
            .map((item) => item.error)
            .join('；')}`
        );
        await onDeleted();
        onClose();
        return;
      }
      if (!response.ok || !payload?.success) {
        throw new Error(
          failed[0]?.error || payload?.error || '批量删除企业失败'
        );
      }
      notify.success(
        deleted.length > 1 ? `已删除 ${deleted.length} 家企业` : '企业已删除'
      );
      await onDeleted();
      onClose();
    } catch (error) {
      notify.error(
        error instanceof Error
          ? error.message
          : props.mode === 'single'
            ? '删除企业失败'
            : '批量删除企业失败'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const title = props.mode === 'single' ? '删除企业' : '批量删除企业';

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={
        configured === false
          ? [
              <Button key="cancel" onClick={onClose}>
                取消
              </Button>,
              <Button
                key="settings"
                type="primary"
                onClick={() => {
                  openSensitivePassword({ onSaved: () => void loadStatus() });
                }}
              >
                去设置安全密码
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose} disabled={submitting}>
                取消
              </Button>,
              <Button
                key="submit"
                danger
                type="primary"
                loading={submitting}
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                {title}
              </Button>,
            ]
      }
    >
      {loadingStatus ? (
        <Typography.Text type="secondary">正在读取安全密码状态…</Typography.Text>
      ) : configured === false ? (
        <Flex vertical gap={8}>
          <Typography.Text>
            删除企业前须先在头像账户菜单中设置个人安全密码。
          </Typography.Text>
          <Typography.Text type="secondary">
            与登录密码分离，用于删除企业等危险操作确认。
          </Typography.Text>
        </Flex>
      ) : (
        <Flex vertical gap={12}>
          <Alert
            type="error"
            showIcon
            message="此操作不可恢复"
            description="将级联清空该企业全部业务数据、员工账号和企业壳。不删除对象存储文件，也不影响其他企业。停用仍是生命周期动作，删除不要求先停用。"
          />
          {props.mode === 'single' ? (
            <>
              <Typography.Text>
                请输入企业全名「{enterprise?.name || ''}」以确认删除。
              </Typography.Text>
              <Input
                value={confirmName}
                placeholder="请输入企业全名"
                autoComplete="off"
                onChange={(event) => setConfirmName(event.target.value)}
              />
            </>
          ) : (
            <>
              <Typography.Text>
                已选择 {batchCount} 家企业
                {batchOverLimit
                  ? `，一次最多删除 ${PLATFORM_ENTERPRISE_BATCH_PURGE_MAX} 家。`
                  : '：'}
              </Typography.Text>
              {batchOverLimit ? null : (
                <Flex vertical gap={4} style={{ maxHeight: 160, overflow: 'auto' }}>
                  {enterprises.map((item) => (
                    <Typography.Text key={item._id}>{item.name}</Typography.Text>
                  ))}
                </Flex>
              )}
              <Typography.Text>
                请输入「{PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT}」以确认批量删除。
              </Typography.Text>
              <Input
                value={confirmText}
                placeholder={PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT}
                autoComplete="off"
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </>
          )}
          <Input.Password
            value={password}
            placeholder="请输入安全密码"
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={() => void handleSubmit()}
          />
        </Flex>
      )}
    </Modal>
  );
}

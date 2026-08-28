'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Flex, Input, Modal, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isPlatformAdminRole } from '@/lib/referrer-join-limits';
import { sensitivePasswordApiPath } from '@/lib/sensitive-password-access';

type SensitivePasswordSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export function SensitivePasswordSettingsModal({
  open,
  onClose,
  onSaved,
}: SensitivePasswordSettingsModalProps) {
  const { user } = useCurrentUser();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const endpoint = sensitivePasswordApiPath(user?.role);
  const isPlatform = isPlatformAdminRole(user?.role);

  const loadStatus = useCallback(async () => {
    if (!user?.role) return;
    setLoading(true);
    try {
      const response = await fetch(sensitivePasswordApiPath(user.role));
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '读取安全密码状态失败');
      }
      setConfigured(Boolean(payload.data?.configured));
    } catch (error) {
      setConfigured(null);
      notify.error(error instanceof Error ? error.message : '读取安全密码状态失败');
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
      setConfigured(null);
      return;
    }
    void loadStatus();
  }, [open, loadStatus]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          confirmPassword,
          currentPassword: configured ? currentPassword : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '保存安全密码失败');
      }
      notify.success(configured ? '安全密码已更新' : '安全密码已设置');
      setPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
      setConfigured(true);
      onSaved?.();
      onClose();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存安全密码失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="修改安全密码"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          disabled={loading}
          onClick={() => void handleSave()}
        >
          {configured ? '更新安全密码' : '设置安全密码'}
        </Button>,
      ]}
    >
      {loading ? (
        <Typography.Text type="secondary">正在读取安全密码状态…</Typography.Text>
      ) : (
        <Flex vertical gap={16}>
          <Alert
            showIcon
            type="info"
            message="用于敏感操作确认"
            description={
              isPlatform
                ? '与登录密码分离，用于删除企业等危险操作确认。'
                : '与登录密码分离，用于导出客资、删除企业等危险操作确认。'
            }
          />
          {configured ? (
            <Input.Password
              value={currentPassword}
              placeholder="当前安全密码"
              autoComplete="off"
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          ) : null}
          <Input.Password
            value={password}
            placeholder={configured ? '新安全密码（6–32 位）' : '设置安全密码（6–32 位）'}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input.Password
            value={confirmPassword}
            placeholder="确认安全密码"
            autoComplete="new-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
            onPressEnter={() => void handleSave()}
          />
          <Typography.Text type="secondary">
            状态：{configured ? '已设置' : '未设置'}
          </Typography.Text>
        </Flex>
      )}
    </Modal>
  );
}

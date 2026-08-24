'use client';

import { useEffect, useState } from 'react';
import { Button, Flex, Input, Modal } from 'antd';
import { notify } from '@/components/admin/operation-feedback';

type LoginPasswordSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export function LoginPasswordSettingsModal({
  open,
  onClose,
}: LoginPasswordSettingsModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '修改登录密码失败');
      }
      notify.success('登录密码已更新');
      onClose();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '修改登录密码失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="修改登录密码"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          取消
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={() => void handleSave()}>
          保存
        </Button>,
      ]}
    >
      <Flex vertical gap={12}>
        <Input.Password
          value={currentPassword}
          placeholder="当前登录密码"
          autoComplete="current-password"
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <Input.Password
          value={newPassword}
          placeholder="新登录密码（6–32 位）"
          autoComplete="new-password"
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <Input.Password
          value={confirmPassword}
          placeholder="确认新登录密码"
          autoComplete="new-password"
          onChange={(event) => setConfirmPassword(event.target.value)}
          onPressEnter={() => void handleSave()}
        />
      </Flex>
    </Modal>
  );
}

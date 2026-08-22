'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Input, Modal, Typography } from 'antd';
import { useAccountSettings } from '@/components/admin/account-settings-provider';
import { notify } from '@/components/admin/operation-feedback';

type SensitivePasswordModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function SensitivePasswordModal({
  open,
  onClose,
  onSuccess,
}: SensitivePasswordModalProps) {
  const { openSensitivePassword } = useAccountSettings();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [password, setPassword] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const response = await fetch('/api/enterprise/sensitive-password');
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '读取安全密码状态失败');
      }
      setConfigured(Boolean(payload.data?.configured));
    } catch (error) {
      setConfigured(null);
      notify.error(error instanceof Error ? error.message : '读取安全密码状态失败');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setConfigured(null);
      return;
    }
    void loadStatus();
  }, [open, loadStatus]);

  const handleExport = async () => {
    if (!password.trim()) {
      notify.warning('请输入安全密码');
      return;
    }
    setExporting(true);
    try {
      const response = await fetch('/api/leads/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ securityPassword: password.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || '导出失败');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = filenameMatch
        ? decodeURIComponent(filenameMatch[1])
        : `客资导出-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      notify.success('客资表格已导出');
      onSuccess?.();
      onClose();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title="导出客资"
      open={open}
      onCancel={onClose}
      destroyOnClose
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
                  onClose();
                  openSensitivePassword();
                }}
              >
                去设置安全密码
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose} disabled={exporting}>
                取消
              </Button>,
              <Button
                key="export"
                type="primary"
                loading={exporting}
                disabled={loadingStatus || configured !== true}
                onClick={() => void handleExport()}
              >
                确认导出
              </Button>,
            ]
      }
    >
      {loadingStatus ? (
        <Typography.Text type="secondary">正在读取安全密码状态…</Typography.Text>
      ) : configured === false ? (
        <Flex vertical gap={8}>
          <Typography.Text>
            导出客资前须先由企业负责人在头像账户菜单中设置企业安全密码。
          </Typography.Text>
          <Typography.Text type="secondary">
            安全密码与登录密码分离，用于导出等敏感操作确认。
          </Typography.Text>
        </Flex>
      ) : (
        <Flex vertical gap={12}>
          <Typography.Text type="secondary">
            将导出本企业全部客资线索（含在用与已归档），表格含手机号等敏感字段。
          </Typography.Text>
          <Input.Password
            value={password}
            placeholder="请输入企业安全密码"
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={() => void handleExport()}
          />
        </Flex>
      )}
    </Modal>
  );
}

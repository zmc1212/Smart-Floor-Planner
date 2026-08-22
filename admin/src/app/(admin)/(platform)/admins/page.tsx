'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ModalForm,
  PageContainer,
  ProFormDependency,
  ProFormSelect,
  ProFormText,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import {
  Alert,
  Avatar,
  Button,
  Dropdown,
  Flex,
  Space,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import {
  Ban,
  CheckCircle2,
  Ellipsis,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'viewer'
  | 'enterprise_admin'
  | 'salesperson';

type AccountScope = 'all' | 'platform' | 'enterprise' | 'salesperson';

type AdminUser = {
  _id: string;
  username: string;
  displayName?: string | null;
  role: AdminRole;
  enterpriseId?: string | null;
  phone?: string | null;
  menuPermissions?: string[];
  effectivePermissions?: string[];
  status: 'active' | 'disabled';
  lastLoginAt?: string | null;
  createdAt?: string;
};

type EnterpriseOption = {
  _id: string;
  name: string;
};

type AccountForm = {
  username: string;
  password?: string;
  displayName?: string;
  phone: string;
  role: AdminRole;
  enterpriseId?: string;
};

type PasswordForm = {
  newPassword: string;
};

const ROLE_OPTIONS: Array<{ label: string; value: AdminRole }> = [
  { label: '超级管理员', value: 'super_admin' },
  { label: '平台管理员', value: 'admin' },
  { label: '只读审计员', value: 'viewer' },
  { label: '企业负责人', value: 'enterprise_admin' },
  { label: '渠道地推', value: 'salesperson' },
];

const ROLE_LABELS = Object.fromEntries(
  ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<AdminRole, string>;

const ROLE_COLORS: Record<AdminRole, string> = {
  super_admin: 'purple',
  admin: 'blue',
  viewer: 'default',
  enterprise_admin: 'gold',
  salesperson: 'green',
};

const SCOPE_OPTIONS: Array<{ label: string; value: AccountScope }> = [
  { label: '全部账号', value: 'all' },
  { label: '平台管理', value: 'platform' },
  { label: '企业账号', value: 'enterprise' },
  { label: '渠道地推', value: 'salesperson' },
];

function isInScope(account: AdminUser, scope: AccountScope) {
  if (scope === 'platform') {
    return ['super_admin', 'admin', 'viewer'].includes(account.role);
  }
  if (scope === 'enterprise') return account.role === 'enterprise_admin';
  return scope !== 'salesperson' || account.role === 'salesperson';
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export default function AdminsPage() {
  const actionRef = useRef<ActionType>(null);
  const confirmAction = useConfirmDialog();
  const { user: currentUser, isLoading: loadingUser } = useCurrentUser();
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([]);
  const [editingAccount, setEditingAccount] = useState<AdminUser | null>(null);
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [resettingAccount, setResettingAccount] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManageAccounts = Boolean(
    ['super_admin', 'admin'].includes(currentUser?.role || '') ||
      currentUser?.effectivePermissions?.includes('admins'),
  );
  const enterpriseOptions = useMemo(
    () => enterprises.map((enterprise) => ({ label: enterprise.name, value: enterprise._id })),
    [enterprises],
  );

  const loadEnterprises = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/enterprises');
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取企业列表失败');
      }
      setEnterprises(result.data || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取企业列表失败');
    }
  }, []);

  useEffect(() => {
    if (canManageAccounts) void loadEnterprises();
  }, [canManageAccounts, loadEnterprises]);

  const saveAccount = async (values: AccountForm) => {
    const isEdit = Boolean(editingAccount);
    const phone = values.phone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      notify.error('请输入 11 位有效手机号');
      return false;
    }
    if (values.role === 'enterprise_admin' && !values.enterpriseId) {
      notify.error('请选择所属企业');
      return false;
    }

    try {
      const body = isEdit
        ? {
            displayName: values.displayName?.trim() || '',
            phone,
            role: values.role,
            enterpriseId:
              values.role === 'enterprise_admin' ? values.enterpriseId : null,
          }
        : {
            username: values.username.trim(),
            password: values.password,
            displayName: values.displayName?.trim() || '',
            phone,
            role: values.role,
            enterpriseId:
              values.role === 'enterprise_admin' ? values.enterpriseId : undefined,
          };
      const response = await fetch(
        isEdit ? `/api/admin-users/${editingAccount?._id}` : '/api/admin-users',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '保存系统账号失败');
      }
      notify.success(isEdit ? '系统账号已更新' : '系统账号已创建');
      setAccountFormOpen(false);
      setEditingAccount(null);
      await actionRef.current?.reload();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存系统账号失败');
      return false;
    }
  };

  const deleteAccount = async (account: AdminUser) => {
    if (busyId) return;
    const confirmed = await confirmAction({
      title: '删除系统账号',
      description: `确定删除“${account.displayName || account.username}”吗？此操作不可撤销。`,
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;

    setBusyId(account._id);
    try {
      const response = await fetch(`/api/admin-users/${account._id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '删除系统账号失败');
      }
      notify.success('系统账号已删除');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除系统账号失败');
    } finally {
      setBusyId(null);
    }
  };

  const toggleAccountStatus = async (account: AdminUser) => {
    if (busyId) return;
    const nextStatus = account.status === 'active' ? 'disabled' : 'active';
    const action = nextStatus === 'disabled' ? '禁用' : '启用';
    const confirmed = await confirmAction({
      title: `${action}系统账号`,
      description: `确定${action}“${account.displayName || account.username}”吗？`,
      confirmText: action,
      destructive: nextStatus === 'disabled',
    });
    if (!confirmed) return;

    setBusyId(account._id);
    try {
      const response = await fetch(`/api/admin-users/${account._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || `${action}系统账号失败`);
      }
      notify.success(`系统账号已${action}`);
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : `${action}系统账号失败`);
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (values: PasswordForm) => {
    if (!resettingAccount) return false;
    try {
      const response = await fetch(`/api/admin-users/${resettingAccount._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '重置密码失败');
      }
      notify.success('密码已重置');
      setResettingAccount(null);
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '重置密码失败');
      return false;
    }
  };

  const columns: ProColumns<AdminUser>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '账号、姓名或手机号' },
    },
    {
      title: '账号范围',
      dataIndex: 'scope',
      valueType: 'select',
      valueEnum: Object.fromEntries(SCOPE_OPTIONS.map((option) => [option.value, option.label])),
      initialValue: 'all',
      hideInTable: true,
    },
    {
      title: '角色',
      dataIndex: 'role',
      valueType: 'select',
      valueEnum: ROLE_LABELS,
      width: 145,
      render: (_, account) => <Tag color={ROLE_COLORS[account.role]}>{ROLE_LABELS[account.role]}</Tag>,
    },
    {
      title: '系统账号',
      dataIndex: 'username',
      width: 250,
      hideInSearch: true,
      render: (_, account) => (
        <Space size={12}>
          <Avatar icon={<ShieldCheck size={16} />} className="!bg-primary !text-primary-foreground">
            {account.displayName?.[0] || account.username[0]?.toUpperCase()}
          </Avatar>
          <Flex vertical gap={0} className="min-w-0">
            <Typography.Text strong ellipsis>{account.displayName || account.username}</Typography.Text>
            <Typography.Text type="secondary" className="text-xs">@{account.username}</Typography.Text>
          </Flex>
        </Space>
      ),
    },
    {
      title: '联系方式',
      dataIndex: 'phone',
      width: 160,
      hideInSearch: true,
      render: (value) => value || <Typography.Text type="secondary">未填写</Typography.Text>,
    },
    {
      title: '账号状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: { active: '正常', disabled: '已禁用' },
      width: 120,
      render: (_, account) => <Tag color={account.status === 'active' ? 'green' : 'default'}>{account.status === 'active' ? '正常' : '已禁用'}</Tag>,
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 180,
      hideInSearch: true,
      render: (_, account) => formatDate(account.lastLoginAt),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      hideInSearch: true,
      render: (_, account) => formatDate(account.createdAt),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 100,
      hideInSearch: true,
      render: (_, account) => {
        if (!canManageAccounts) return '-';
        const isBusy = busyId === account._id;
        const items: MenuProps['items'] = [
          {
            key: 'edit',
            label: '编辑账号',
            icon: <Pencil size={15} />,
            disabled: isBusy,
            onClick: () => {
              setEditingAccount(account);
              setAccountFormOpen(true);
            },
          },
          {
            key: 'password',
            label: '重置密码',
            icon: <KeyRound size={15} />,
            disabled: isBusy,
            onClick: () => setResettingAccount(account),
          },
          {
            key: 'status',
            label: account.status === 'active' ? '禁用账号' : '启用账号',
            icon: account.status === 'active' ? <Ban size={15} /> : <CheckCircle2 size={15} />,
            disabled: isBusy,
            onClick: () => void toggleAccountStatus(account),
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: '删除账号',
            icon: <Trash2 size={15} />,
            danger: true,
            disabled: isBusy,
            onClick: () => void deleteAccount(account),
          },
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Tooltip title="更多操作">
              <Button size="small" aria-label={`${account.displayName || account.username} 更多操作`} icon={<Ellipsis size={16} />} loading={isBusy} />
            </Tooltip>
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="系统账号管理"
        content="维护平台、企业与渠道账号。角色、账号状态和密码变更即时生效。"
        extra={canManageAccounts ? [
          <Button key="create" type="primary" icon={<Plus size={16} />} onClick={() => { setEditingAccount(null); setAccountFormOpen(true); }}>新增账号</Button>,
        ] : undefined}
      >
        {loadingUser ? (
          <Alert showIcon type="info" message="正在加载账号权限" />
        ) : !canManageAccounts ? (
          <Alert showIcon type="warning" message="当前账号仅有查看权限" description="需要“系统账号管理”菜单权限，才能创建或维护系统账号。" />
        ) : null}

        <ProTable<AdminUser>
          className="admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1120 }}
          request={async (params) => {
            const response = await fetch('/api/admin-users');
            const result = await response.json();
            if (!response.ok || !result.success) {
              throw new Error(result.error || '读取系统账号失败');
            }
            const keyword = String(params.keyword || '').trim().toLowerCase();
            const scope = (params.scope || 'all') as AccountScope;
            const role = params.role ? String(params.role) : '';
            const accounts = (result.data as AdminUser[] || []).filter((account) => {
              if (!isInScope(account, scope) || (role && account.role !== role)) return false;
              if (!keyword) return true;
              return [account.username, account.displayName, account.phone]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(keyword));
            });
            const pageSize = Number(params.pageSize || 20);
            const current = Number(params.current || 1);
            return {
              data: accounts.slice((current - 1) * pageSize, current * pageSize),
              total: accounts.length,
              success: true,
            };
          }}
          onRequestError={(error) => notify.error(error instanceof Error ? error.message : '读取系统账号失败')}
        />
      </PageContainer>

      <ModalForm<AccountForm>
        key={editingAccount?._id || 'create-account'}
        title={editingAccount ? '编辑系统账号' : '新增系统账号'}
        open={accountFormOpen}
        initialValues={editingAccount ? {
          username: editingAccount.username,
          displayName: editingAccount.displayName || '',
          phone: editingAccount.phone || '',
          role: editingAccount.role,
          enterpriseId: editingAccount.enterpriseId || undefined,
        } : { role: 'admin' }}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => {
          setAccountFormOpen(open);
          if (!open) setEditingAccount(null);
        }}
        onFinish={saveAccount}
        submitter={{
          searchConfig: { submitText: editingAccount ? '保存账号' : '创建账号' },
          render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex>,
        }}
      >
        {editingAccount ? (
          <ProFormText name="username" label="登录账号" readonly />
        ) : (
          <ProFormText name="username" label="登录账号" rules={[{ required: true, message: '请输入登录账号' }]} fieldProps={{ placeholder: '例如：admin_zhang' }} />
        )}
        {!editingAccount ? (
          <ProFormText name="password" label="初始密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]} fieldProps={{ type: 'password', placeholder: '至少 6 位' }} />
        ) : null}
        <ProFormText name="displayName" label="显示名称" fieldProps={{ placeholder: '例如：张三' }} />
        <ProFormText name="phone" label="联系电话" rules={[{ required: true, pattern: /^1[3-9]\d{9}$/, message: '请输入 11 位有效手机号' }]} fieldProps={{ maxLength: 11, placeholder: '13800138000' }} />
        <ProFormSelect name="role" label="系统角色" options={ROLE_OPTIONS} rules={[{ required: true, message: '请选择系统角色' }]} />
        <ProFormDependency name={['role']}>
          {({ role }) => role === 'enterprise_admin' ? (
            <ProFormSelect
              name="enterpriseId"
              label="所属企业"
              options={enterpriseOptions}
              rules={[{ required: true, message: '请选择所属企业' }]}
              fieldProps={{ showSearch: true, optionFilterProp: 'label', placeholder: '选择所属企业' }}
            />
          ) : role === 'salesperson' ? (
            <Alert showIcon type="info" message="渠道地推账号不绑定企业" description="保存时系统会清除该账号的企业归属。" />
          ) : null}
        </ProFormDependency>
      </ModalForm>

      <ModalForm<PasswordForm>
        key={resettingAccount?._id || 'reset-password'}
        title="重置系统账号密码"
        open={Boolean(resettingAccount)}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => {
          if (!open) setResettingAccount(null);
        }}
        onFinish={resetPassword}
        submitter={{
          searchConfig: { submitText: '确认重置' },
          render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex>,
        }}
      >
        <Alert showIcon type="warning" message={`正在重置 @${resettingAccount?.username || ''} 的密码`} />
        <ProFormText name="newPassword" label="新密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]} fieldProps={{ type: 'password', placeholder: '至少 6 位' }} />
      </ModalForm>
    </div>
  );
}

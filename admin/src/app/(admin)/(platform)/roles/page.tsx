'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, Button, Card, Checkbox, Empty, Flex, Result, Skeleton, Tag, Typography } from 'antd';
import { RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import {
  ALL_MENUS,
  getDefaultMenuKeys,
  getMenuLabel,
  MENU_PERMISSION_GROUPS,
} from '@/lib/admin-user-roles';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type RoleConfig = {
  _id: string;
  roleKey: string;
  label: string;
  menuKeys: string[];
};

const KNOWN_MENU_KEYS = new Set(ALL_MENUS.map((menu) => menu.key));

function sameMenuKeys(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right);
  return left.every((key) => rightKeys.has(key));
}

export default function RolesPage() {
  const { user: currentUser, isLoading: loadingUser } = useCurrentUser();
  const [roles, setRoles] = useState<RoleConfig[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const selectedRoleIdRef = useRef<string | null>(null);
  const [menuKeys, setMenuKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canManageRoles = ['admin', 'super_admin'].includes(currentUser?.role || '');
  const selectedRole = useMemo(
    () => roles.find((role) => role._id === selectedRoleId) || null,
    [roles, selectedRoleId],
  );
  const hasUnsavedChanges = Boolean(selectedRole && !sameMenuKeys(menuKeys, selectedRole.menuKeys));
  const legacyMenuKeys = useMemo(() => menuKeys.filter((key) => !KNOWN_MENU_KEYS.has(key)), [menuKeys]);
  const selectableMenuKeys = useMemo(() => menuKeys.filter((key) => KNOWN_MENU_KEYS.has(key)), [menuKeys]);
  const defaultMenuKeys = useMemo(
    () => (selectedRole ? getDefaultMenuKeys(selectedRole.roleKey) : []),
    [selectedRole],
  );
  const matchesCodeDefaults = Boolean(selectedRole && sameMenuKeys(menuKeys, defaultMenuKeys));

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/roles');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取角色配置失败');

      const nextRoles = result.data as RoleConfig[];
      setRoles(nextRoles);
      const nextRole = nextRoles.find((role) => role._id === selectedRoleIdRef.current) || nextRoles[0] || null;
      selectedRoleIdRef.current = nextRole?._id || null;
      setSelectedRoleId(nextRole?._id || null);
      setMenuKeys(nextRole?.menuKeys || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取角色配置失败';
      setLoadError(message);
      notify.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManageRoles) void loadRoles();
  }, [canManageRoles, loadRoles]);

  const selectRole = (role: RoleConfig) => {
    if (hasUnsavedChanges && role._id !== selectedRoleId && !window.confirm('当前角色存在未保存的菜单变更。切换角色将放弃这些修改，是否继续？')) {
      return;
    }
    selectedRoleIdRef.current = role._id;
    setSelectedRoleId(role._id);
    setMenuKeys(role.menuKeys);
  };

  const restoreDefaults = () => {
    if (!selectedRole) return;
    const nextKeys = getDefaultMenuKeys(selectedRole.roleKey);
    if (!nextKeys.length) {
      notify.error('该角色没有代码默认菜单');
      return;
    }
    setMenuKeys(nextKeys);
    notify.success(`已填入${selectedRole.label}的代码默认菜单，请保存后写入数据库`);
  };

  const saveRole = async () => {
    if (!selectedRole || !hasUnsavedChanges) return;
    setSaving(true);
    try {
      const response = await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedRole._id, menuKeys }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存角色权限失败');

      const updatedRole = result.data as RoleConfig;
      setRoles((currentRoles) => currentRoles.map((role) => role._id === updatedRole._id ? updatedRole : role));
      setMenuKeys(updatedRole.menuKeys);
      notify.success(`${updatedRole.label}的默认菜单已保存`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存角色权限失败');
    } finally {
      setSaving(false);
    }
  };

  if (loadingUser) {
    return <div className="admin-page-frame"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  }

  if (!canManageRoles) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="角色权限管理">
          <Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以维护默认角色菜单。" />
        </PageContainer>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="角色权限管理">
          <Result
            status="error"
            title="角色配置加载失败"
            subTitle={loadError}
            extra={<Button type="primary" icon={<RefreshCw size={16} />} onClick={() => void loadRoles()}>重新加载</Button>}
          />
        </PageContainer>
      </div>
    );
  }

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="角色权限管理"
        content="按侧栏业务分组维护各系统角色的默认菜单。保存更新 system_roles；已有账号的有效权限跟随角色菜单，恢复默认并保存可校准库中旧行。"
        extra={[
          <Button key="refresh" icon={<RefreshCw size={16} />} loading={loading} onClick={() => void loadRoles()}>刷新</Button>,
          <Button
            key="restore"
            icon={<RotateCcw size={16} />}
            disabled={!selectedRole || matchesCodeDefaults}
            onClick={restoreDefaults}
          >
            恢复该角色默认
          </Button>,
          <Button key="save" type="primary" icon={<Save size={16} />} loading={saving} disabled={!selectedRole || !hasUnsavedChanges} onClick={() => void saveRole()}>保存权限</Button>,
        ]}
      >
        <Flex gap={24} align="start" wrap="wrap">
          <Card
            title="系统角色"
            extra={loading ? null : <Tag color="green">{roles.length} 个</Tag>}
            className="admin-panel-card w-full xl:w-80"
            styles={{ body: { padding: 12 } }}
          >
            {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : roles.length ? (
              <Flex vertical gap={4}>
                {roles.map((role) => {
                  const active = selectedRoleId === role._id;
                  return (
                    <Button
                      key={role._id}
                      type={active ? 'primary' : 'text'}
                      className="!h-auto !justify-start !px-3 !py-3"
                      onClick={() => selectRole(role)}
                    >
                      <Flex justify="space-between" align="center" className="w-full" gap={12}>
                        <Flex vertical align="start" gap={2} className="min-w-0">
                          <Typography.Text strong className={active ? '!text-primary-foreground' : ''}>{role.label}</Typography.Text>
                          <Typography.Text type={active ? undefined : 'secondary'} className={active ? '!text-primary-foreground/75 text-xs' : 'text-xs'}>{role.roleKey}</Typography.Text>
                        </Flex>
                        <Tag color={active ? 'default' : 'green'}>{role.menuKeys.length}</Tag>
                      </Flex>
                    </Button>
                  );
                })}
              </Flex>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无系统角色" />}
          </Card>

          <Card className="admin-panel-card min-w-0 flex-1" styles={{ body: { padding: 24 } }}>
            {selectedRole ? (
              <Flex vertical gap={20}>
                <Flex justify="space-between" align="start" wrap="wrap" gap={16}>
                  <Flex vertical gap={4}>
                    <Typography.Title level={4} className="!mb-0"><ShieldCheck size={19} className="mr-2 inline text-primary" />{selectedRole.label}默认菜单</Typography.Title>
                    <Typography.Text type="secondary">选择该角色在账号初始化时默认可见的管理菜单；分组与侧栏业务分类一致。</Typography.Text>
                  </Flex>
                  <Tag color={hasUnsavedChanges ? 'warning' : 'success'}>{hasUnsavedChanges ? '存在未保存变更' : '已同步'}</Tag>
                </Flex>

                <Alert
                  type="info"
                  showIcon
                  message="权限生效范围"
                  description="此处更新角色默认菜单（system_roles.menuKeys）。账号有效权限由其角色菜单与路由守卫决定；代码默认变更不会自动覆盖库中旧行，可点「恢复该角色默认」后再保存校准。"
                />

                {legacyMenuKeys.length ? <Alert type="warning" showIcon message={`保留 ${legacyMenuKeys.length} 个历史菜单权限`} description="这些权限不在当前菜单目录中展示；保存可见配置时会原样保留。恢复默认会清除历史键。" /> : null}

                <Checkbox.Group
                  value={selectableMenuKeys}
                  onChange={(values) => setMenuKeys([...new Set([...legacyMenuKeys, ...(values as string[])])])}
                  className="w-full"
                >
                  <Flex vertical gap={20} className="w-full">
                    {MENU_PERMISSION_GROUPS.map((group) => (
                      <div key={group.title} className="admin-permission-group">
                        <Flex vertical gap={4} className="mb-3">
                          <Typography.Text strong>{group.title}</Typography.Text>
                          {group.description ? (
                            <Typography.Text type="secondary" className="text-xs">{group.description}</Typography.Text>
                          ) : null}
                        </Flex>
                        <div className="admin-permission-grid">
                          {group.keys.map((key) => (
                            <Checkbox
                              key={key}
                              value={key}
                              className="admin-permission-option"
                            >
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="font-medium">{getMenuLabel(key)}</span>
                                <span className="truncate text-xs text-muted-foreground">{key}</span>
                              </span>
                            </Checkbox>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Flex>
                </Checkbox.Group>

                <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                  <Typography.Text type="secondary">已选择 {menuKeys.length} / {ALL_MENUS.length} 个菜单</Typography.Text>
                  <Flex gap={8} wrap="wrap">
                    <Button icon={<RotateCcw size={16} />} disabled={matchesCodeDefaults} onClick={restoreDefaults}>
                      恢复该角色默认
                    </Button>
                    <Button type="primary" icon={<Save size={16} />} loading={saving} disabled={!hasUnsavedChanges} onClick={() => void saveRole()}>保存权限</Button>
                  </Flex>
                </Flex>
              </Flex>
            ) : <Empty description="请选择一个系统角色" />}
          </Card>
        </Flex>
      </PageContainer>
    </div>
  );
}

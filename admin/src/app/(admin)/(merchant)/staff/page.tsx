'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Alert, Avatar, Button, Card, Drawer, Flex, Form, Select, Space, Switch, Tag, Tooltip, Tree, Typography, type TreeDataNode } from 'antd';
import { Award, FolderPlus, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCheck, Users, Wrench } from 'lucide-react';
import ModuleOverview from '@/components/admin/ModuleOverview';
import { ImageUploadField } from '@/components/admin/image-upload-field';
import { notify } from '@/components/admin/operation-feedback';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type Department = {
  _id: string;
  name: string;
  parentId?: string | null;
};

type StaffMember = {
  _id: string;
  username: string;
  displayName?: string;
  phone?: string | null;
  role: StaffRole;
  status?: string;
  departmentId?: { _id: string; name?: string } | string | null;
  createdAt?: string;
  wechatId?: string | null;
  wechatQrAssetId?: string | null;
  assignmentPaused?: boolean;
  leadCapacityOverride?: number | null;
  mustChangePassword?: boolean;
};

type StaffRole = 'enterprise_admin' | 'designer' | 'measurer' | 'salesperson';

type StaffForm = {
  username?: string;
  displayName: string;
  phone?: string;
  role: StaffRole;
  departmentId?: string;
  wechatId?: string;
  wechatQrAssetId?: string;
  assignmentPaused?: boolean;
  leadCapacityOverride?: number | null;
};

type DepartmentForm = { name: string; parentId?: string };

type EnterpriseProfileSettings = {
  designerTitle: string;
  measurerTitle: string;
  defaultExperienceYears: number;
  serviceThreshold: number;
  forceEnterpriseProfile: boolean;
  titleVisibilityPolicy: 'follow_staff' | 'force_show' | 'force_hide';
};

type StaffProfessionalProfile = {
  role: 'designer' | 'measurer';
  adminTitleOverride: string;
  careerStartYear: number | null;
  staffTitleVisible: boolean;
  profileLocked: boolean;
  showActualServiceCount: boolean;
  actualServiceCount: number;
  canShowActualServiceCount: boolean;
  titleVisible: boolean;
  title: string | null;
  experienceLabel: string;
  serviceLabel: string;
  enterpriseForceProfile: boolean;
  enterpriseTitleVisibilityPolicy: EnterpriseProfileSettings['titleVisibilityPolicy'];
};

type StaffProfessionalForm = {
  adminTitleOverride?: string;
  careerStartYear?: number | null;
  titleVisible: boolean;
  profileLocked: boolean;
  showActualServiceCount: boolean;
};

type PermissionEffect = 'inherit' | 'allow' | 'deny';
type PermissionStaff = {
  _id: string;
  displayName?: string;
  username: string;
  role: 'designer' | 'measurer';
  effect: PermissionEffect;
  effectiveAllowed: boolean;
};

const ROLE_OPTIONS: Array<{ label: string; value: StaffRole }> = [
  { label: '设计师', value: 'designer' },
  { label: '测量员', value: 'measurer' },
  { label: '渠道地推', value: 'salesperson' },
];

const ROLE_LABELS: Record<StaffRole, string> = {
  enterprise_admin: '企业负责人',
  designer: '设计师',
  measurer: '测量员',
  salesperson: '渠道地推',
};

const ROLE_COLORS: Record<StaffRole, string> = {
  enterprise_admin: 'purple',
  designer: 'blue',
  measurer: 'gold',
  salesperson: 'green',
};

function departmentIdOf(member: StaffMember) {
  if (!member.departmentId) return '';
  return typeof member.departmentId === 'string' ? member.departmentId : member.departmentId._id;
}

function departmentNameOf(member: StaffMember, departments: Department[]) {
  if (!member.departmentId) return '未分配部门';
  if (typeof member.departmentId !== 'string') return member.departmentId.name || '未分配部门';
  return departments.find((department) => department._id === member.departmentId)?.name || '未分配部门';
}

function makeDepartmentTree(
  departments: Department[],
  canManage: boolean,
  onEdit: (department: Department) => void,
  onDelete: (department: Department) => void,
) {
  const childrenByParent = new Map<string, Department[]>();
  for (const department of departments) {
    const parentKey = department.parentId || 'root';
    childrenByParent.set(parentKey, [...(childrenByParent.get(parentKey) || []), department]);
  }

  const toNodes = (parentId: string | null): TreeDataNode[] => (childrenByParent.get(parentId || 'root') || []).map((department) => ({
    key: department._id,
    title: (
      <Flex align="center" justify="space-between" gap={8} className="min-w-0">
        <Typography.Text ellipsis>{department.name}</Typography.Text>
        {canManage ? (
          <Space size={0} onClick={(event) => event.stopPropagation()}>
            <Tooltip title="编辑部门"><Button aria-label={`编辑 ${department.name}`} type="text" size="small" icon={<Pencil size={14} />} onClick={() => onEdit(department)} /></Tooltip>
            <Tooltip title="删除部门"><Button aria-label={`删除 ${department.name}`} type="text" danger size="small" icon={<Trash2 size={14} />} onClick={() => onDelete(department)} /></Tooltip>
          </Space>
        ) : null}
      </Flex>
    ),
    children: toNodes(department._id),
  }));

  return toNodes(null);
}

export default function StaffPage() {
  const actionRef = useRef<ActionType>(null);
  const confirmAction = useConfirmDialog();
  const { user: currentUser } = useCurrentUser();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffFormOpen, setStaffFormOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [departmentParentId, setDepartmentParentId] = useState<string | null>(null);
  const [departmentFormOpen, setDepartmentFormOpen] = useState(false);
  const [globalTenantId, setGlobalTenantId] = useState('all');
  const [overview, setOverview] = useState({ total: 0, designers: 0, measurers: 0 });
  const [staffRole, setStaffRole] = useState<StaffRole>('designer');
  const [wechatQrAssetId, setWechatQrAssetId] = useState<string | null>(null);
  const [wechatQrPreviewUrl, setWechatQrPreviewUrl] = useState<string | null>(null);
  const [permissionDrawerOpen, setPermissionDrawerOpen] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [permissionRoleDefaults, setPermissionRoleDefaults] = useState({ designer: false, measurer: false });
  const [permissionStaff, setPermissionStaff] = useState<PermissionStaff[]>([]);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [profileSettings, setProfileSettings] = useState<EnterpriseProfileSettings | null>(null);
  const [profileSettingsLoading, setProfileSettingsLoading] = useState(false);
  const [professionalStaff, setProfessionalStaff] = useState<StaffMember | null>(null);
  const [professionalProfile, setProfessionalProfile] = useState<StaffProfessionalProfile | null>(null);
  const [professionalProfileOpen, setProfessionalProfileOpen] = useState(false);
  const [professionalProfileLoading, setProfessionalProfileLoading] = useState(false);

  const canManage = ['super_admin', 'admin', 'enterprise_admin'].includes(currentUser?.role || '');
  const requiresTenantSelection = Boolean(
    ['super_admin', 'admin'].includes(currentUser?.role || '') && globalTenantId === 'all'
  );

  const loadActionPermissions = useCallback(async () => {
    setPermissionLoading(true);
    try {
      const response = await fetch('/api/staff/action-permissions');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取线索归档权限失败');
      setPermissionRoleDefaults(result.data.roleDefaults);
      setPermissionStaff(result.data.staff || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取线索归档权限失败');
    } finally {
      setPermissionLoading(false);
    }
  }, []);

  const openPermissionDrawer = () => {
    setPermissionDrawerOpen(true);
    void loadActionPermissions();
  };

  const saveActionPermissions = async () => {
    setPermissionSaving(true);
    try {
      const response = await fetch('/api/staff/action-permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleDefaults: permissionRoleDefaults,
          userOverrides: permissionStaff.map((member) => ({ userId: member._id, effect: member.effect })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存线索归档权限失败');
      notify.success('线索归档权限已保存');
      await loadActionPermissions();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存线索归档权限失败');
    } finally {
      setPermissionSaving(false);
    }
  };

  const loadProfileSettings = async () => {
    setProfileSettingsLoading(true);
    try {
      const response = await fetch('/api/professional-profile-settings');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取企业专业背书失败');
      setProfileSettings(result.data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取企业专业背书失败');
    } finally {
      setProfileSettingsLoading(false);
    }
  };

  const openProfileSettings = () => {
    setProfileSettingsOpen(true);
    void loadProfileSettings();
  };

  const saveProfileSettings = async (values: EnterpriseProfileSettings) => {
    try {
      const response = await fetch('/api/professional-profile-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存企业专业背书失败');
      setProfileSettings(result.data);
      setProfileSettingsOpen(false);
      notify.success('企业专业背书已全局生效');
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存企业专业背书失败');
      return false;
    }
  };

  const openStaffProfessionalProfile = async (member: StaffMember) => {
    setProfessionalStaff(member);
    setProfessionalProfile(null);
    setProfessionalProfileOpen(true);
    setProfessionalProfileLoading(true);
    try {
      const response = await fetch(`/api/staff/${member._id}/professional-profile`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取员工专业背书失败');
      setProfessionalProfile(result.data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取员工专业背书失败');
      setProfessionalProfileOpen(false);
    } finally {
      setProfessionalProfileLoading(false);
    }
  };

  const saveStaffProfessionalProfile = async (values: StaffProfessionalForm) => {
    if (!professionalStaff) return false;
    try {
      const response = await fetch(`/api/staff/${professionalStaff._id}/professional-profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存员工专业背书失败');
      setProfessionalProfile(result.data);
      setProfessionalProfileOpen(false);
      notify.success('员工专业背书已更新');
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存员工专业背书失败');
      return false;
    }
  };
  const staffRoleOptions = useMemo(
    () => currentUser?.role === 'super_admin' ? [...ROLE_OPTIONS, { label: '企业负责人', value: 'enterprise_admin' as StaffRole }] : ROLE_OPTIONS,
    [currentUser?.role],
  );

  const loadDepartments = useCallback(async () => {
    if (!currentUser || requiresTenantSelection) return;
    try {
      const response = await fetch('/api/departments');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取部门失败');
      setDepartments(result.data || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取部门失败');
    }
  }, [currentUser, requiresTenantSelection]);

  useEffect(() => {
    const tenantCookie = document.cookie.split('; ').find((item) => item.startsWith('global_tenant_id='));
    setGlobalTenantId(tenantCookie?.split('=')[1] || 'all');
  }, []);
  useEffect(() => { void loadDepartments(); }, [loadDepartments]);
  useEffect(() => { if (!requiresTenantSelection) void actionRef.current?.reload(); }, [requiresTenantSelection, selectedDepartmentId]);
  useEffect(() => {
    setStaffRole(editingStaff?.role || 'designer');
    setWechatQrAssetId(editingStaff?.wechatQrAssetId || null);
    setWechatQrPreviewUrl(null);
  }, [editingStaff]);
  useEffect(() => {
    const assetId = editingStaff?.wechatQrAssetId;
    if (!assetId) return;
    void fetch(`/api/staff/wechat-qr?assetId=${assetId}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '读取个人微信二维码失败');
        setWechatQrPreviewUrl(result.data.imageUrl);
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : '读取个人微信二维码失败'));
  }, [editingStaff?.wechatQrAssetId]);

  const saveStaff = async (values: StaffForm) => {
    const isEdit = Boolean(editingStaff);
    try {
      const response = await fetch(isEdit ? `/api/staff/${editingStaff?._id}` : '/api/staff', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, departmentId: values.departmentId || '', wechatQrAssetId: wechatQrAssetId || values.wechatQrAssetId || '' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存员工失败');
      notify.success(isEdit ? '员工信息已更新' : '员工账号已创建，初始密码为 123456');
      setStaffFormOpen(false);
      setEditingStaff(null);
      setWechatQrAssetId(null);
      setWechatQrPreviewUrl(null);
      await actionRef.current?.reload();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存员工失败');
      return false;
    }
  };

  const deleteStaff = async (member: StaffMember) => {
    const confirmed = await confirmAction({ title: '删除员工账号', description: `确定删除“${member.displayName || member.username}”吗？此操作不可撤销。`, confirmText: '删除', destructive: true });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/staff/${member._id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除员工失败');
      notify.success('员工账号已删除');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除员工失败');
    }
  };

  const resetStaffPassword = async (member: StaffMember) => {
    const confirmed = await confirmAction({
      title: '重置员工登录密码',
      description: `将“${member.displayName || member.username}”的登录密码重置为 123456。该员工下次使用密码登录时必须先设置新密码。`,
      confirmText: '确认重置',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/staff/${member._id}/reset-password`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '重置员工密码失败');
      }
      notify.success('密码已重置为 123456，员工下次登录须先修改密码');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '重置员工密码失败');
    }
  };

  const saveDepartment = async (values: DepartmentForm) => {
    const isEdit = Boolean(editingDepartment);
    try {
      const response = await fetch(isEdit ? `/api/departments/${editingDepartment?._id}` : '/api/departments', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: values.name, parentId: values.parentId || null }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存部门失败');
      notify.success(isEdit ? '部门已更新' : '部门已创建');
      setDepartmentFormOpen(false);
      setEditingDepartment(null);
      setDepartmentParentId(null);
      await Promise.all([loadDepartments(), actionRef.current?.reload()]);
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存部门失败');
      return false;
    }
  };

  const deleteDepartment = async (department: Department) => {
    const confirmed = await confirmAction({ title: '删除部门', description: `确定删除“${department.name}”吗？`, confirmText: '删除', destructive: true });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/departments/${department._id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除部门失败');
      if (selectedDepartmentId === department._id) setSelectedDepartmentId(null);
      notify.success('部门已删除');
      await Promise.all([loadDepartments(), actionRef.current?.reload()]);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除部门失败');
    }
  };

  const departmentTree = makeDepartmentTree(departments, canManage, (department) => {
    setEditingDepartment(department);
    setDepartmentParentId(department.parentId || null);
    setDepartmentFormOpen(true);
  }, deleteDepartment);

  const columns: ProColumns<StaffMember>[] = [
    { title: '搜索', dataIndex: 'search', hideInTable: true, fieldProps: { placeholder: '姓名、账号或手机号' } },
    { title: '岗位', dataIndex: 'role', valueType: 'select', valueEnum: Object.fromEntries(staffRoleOptions.map((option) => [option.value, option.label])), width: 130, render: (_, member) => <Tag color={ROLE_COLORS[member.role]}>{ROLE_LABELS[member.role]}</Tag> },
    {
      title: '员工', dataIndex: 'displayName', width: 240, hideInSearch: true,
      render: (_, member) => <Space size={12}><Avatar icon={<Users size={16} />} className="!bg-primary !text-primary-foreground">{member.displayName?.[0] || member.username[0]?.toUpperCase()}</Avatar><Flex vertical gap={0}><Typography.Text strong>{member.displayName || member.username}</Typography.Text><Typography.Text type="secondary" className="text-xs">@{member.username}</Typography.Text></Flex></Space>,
    },
    { title: '登录手机号', dataIndex: 'phone', width: 160, hideInSearch: true, render: (value) => value || <Typography.Text type="secondary">未填写</Typography.Text> },
    {
      title: '登录状态',
      key: 'loginStatus',
      width: 140,
      hideInSearch: true,
      render: (_, member) => member.mustChangePassword
        ? <Tag color="orange">首次登录待改密</Tag>
        : <Tag color="green">密码已设置</Tag>,
    },
    { title: '所属部门', key: 'department', width: 180, hideInSearch: true, render: (_, member) => <Typography.Text>{departmentNameOf(member, departments)}</Typography.Text> },
    {
      title: '自动派单',
      key: 'assignmentPaused',
      width: 120,
      hideInSearch: true,
      render: (_, member) => ['designer', 'measurer'].includes(member.role)
        ? <Tag color={member.status === 'active' && !member.assignmentPaused ? 'green' : 'default'}>{member.assignmentPaused ? '已暂停' : member.status === 'active' ? '可参与' : '账号未启用'}</Tag>
        : <Typography.Text type="secondary">不适用</Typography.Text>,
    },
    { title: '创建时间', dataIndex: 'createdAt', valueType: 'dateTime', width: 180, hideInSearch: true, render: (_, member) => member.createdAt ? new Date(member.createdAt).toLocaleString() : '-' },
    {
      title: '操作', key: 'actions', valueType: 'option', fixed: 'right', width: 360, hideInSearch: true,
      render: (_, member) => {
        if (!canManage) return [];
        const canResetPassword =
          currentUser?._id !== member._id &&
          !(currentUser?.role === 'enterprise_admin' && member.role === 'enterprise_admin');
        return <Space size={8}>
          {['designer', 'measurer'].includes(member.role) ? <Button size="small" icon={<Award size={14} />} onClick={() => { void openStaffProfessionalProfile(member); }}>背书</Button> : null}
          {canResetPassword ? <Button size="small" icon={<KeyRound size={14} />} onClick={() => { void resetStaffPassword(member); }}>重置密码</Button> : null}
          <Button size="small" icon={<Pencil size={14} />} onClick={() => { setStaffRole(member.role); setEditingStaff(member); setStaffFormOpen(true); }}>编辑</Button>
          <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => { void deleteStaff(member); }}>删除</Button>
        </Space>;
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="员工管理"
        content="管理企业内的地推、测量、设计与负责人账号，并按部门快速筛选。"
        extra={canManage && !requiresTenantSelection ? [
          <Button key="professional-profile" icon={<Award size={16} />} onClick={openProfileSettings}>专业背书设置</Button>,
          <Button key="permissions" icon={<ShieldCheck size={16} />} onClick={openPermissionDrawer}>线索归档权限</Button>,
          <Button key="create" type="primary" icon={<Plus size={16} />} onClick={() => { setStaffRole('designer'); setEditingStaff(null); setStaffFormOpen(true); }}>新增员工</Button>,
        ] : undefined}
      >
        {requiresTenantSelection ? (
          <Alert
            showIcon
            type="info"
            message="请先选择企业"
            description="平台管理员需要在左侧导航栏切换到具体企业，才能查看和维护该企业的员工与部门。"
          />
        ) : !currentUser ? (
          <Alert showIcon type="info" message="正在加载员工权限" />
        ) : (
          <>
            <div className="admin-staff-layout">
              <Card title="部门结构" className="admin-department-panel admin-panel-card w-full">
                <Flex vertical gap={16}>
                  <Flex justify="space-between" align="center">
                    <Button type={selectedDepartmentId === null ? 'primary' : 'default'} onClick={() => setSelectedDepartmentId(null)}>全部员工</Button>
                    {canManage ? <Tooltip title="新增顶级部门"><Button aria-label="新增顶级部门" type="text" icon={<FolderPlus size={18} />} onClick={() => { setEditingDepartment(null); setDepartmentParentId(null); setDepartmentFormOpen(true); }} /></Tooltip> : null}
                  </Flex>
                  <Tree
                    blockNode
                    defaultExpandAll
                    selectedKeys={selectedDepartmentId ? [selectedDepartmentId] : []}
                    treeData={departmentTree}
                    onSelect={(keys) => setSelectedDepartmentId(typeof keys[0] === 'string' ? keys[0] : null)}
                  />
                </Flex>
              </Card>

              <div className="min-w-0 flex-1">
                <ModuleOverview
                  ariaLabel="团队概览"
                  items={[
                    { label: '本页团队成员', value: overview.total, icon: <Users size={18} /> },
                    { label: '本页设计师', value: overview.designers, icon: <UserCheck size={18} />, tone: 'success' },
                    { label: '本页测量员', value: overview.measurers, icon: <Wrench size={18} />, tone: 'warning' },
                    { label: '部门结构', value: departments.length, icon: <FolderPlus size={18} /> },
                  ]}
                />
                <ProTable<StaffMember>
                  className="admin-data-table admin-mobile-filter-stack"
                  actionRef={actionRef}
                  rowKey="_id"
                  columns={columns}
                  search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
                  options={{ reload: true, density: true, setting: true }}
                  pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 1180 }}
                  request={async (params) => {
                    const query = new URLSearchParams({ page: String(params.current || 1), limit: String(params.pageSize || 20) });
                    if (selectedDepartmentId) query.set('departmentId', selectedDepartmentId);
                    if (params.search) query.set('search', String(params.search));
                    if (params.role) query.set('roles', String(params.role));
                    const response = await fetch(`/api/staff?${query}`);
                    const result = await response.json();
                    if (!response.ok || !result.success) throw new Error(result.error || '读取员工失败');
                    const rows = result.data || [];
                    const nextOverview = {
                      total: rows.length,
                      designers: rows.filter((member: StaffMember) => member.role === 'designer').length,
                      measurers: rows.filter((member: StaffMember) => member.role === 'measurer').length,
                    };
                    setOverview((current) => (
                      current.total === nextOverview.total &&
                        current.designers === nextOverview.designers &&
                        current.measurers === nextOverview.measurers
                        ? current
                        : nextOverview
                    ));
                    return { data: result.data || [], total: result.pagination?.total || 0, success: true };
                  }}
                />
              </div>
            </div>
          </>
        )}
      </PageContainer>

      <Drawer
        open={permissionDrawerOpen}
        width={720}
        destroyOnHidden
        title="线索归档权限"
        onClose={() => { if (!permissionSaving) setPermissionDrawerOpen(false); }}
        extra={<Button type="primary" icon={<ShieldCheck size={16} />} loading={permissionSaving} disabled={permissionLoading} onClick={() => void saveActionPermissions()}>保存权限</Button>}
      >
        <Flex vertical gap={24}>
          <Alert
            showIcon
            type="info"
            message="企业负责人和平台管理员始终拥有此权限"
            description="设计师和测量员先继承本企业的角色默认值，再应用个人覆盖。归档只隐藏客户档案，不删除户型、AI 方案、提成或历史记录。"
          />
          <Flex vertical gap={12}>
            <Typography.Title level={5} className="!mb-0">角色默认</Typography.Title>
            <Flex justify="space-between" align="center" gap={16} className="rounded-lg bg-muted px-4 py-3">
              <Flex vertical gap={2}>
                <Typography.Text strong>设计师</Typography.Text>
                <Typography.Text type="secondary">默认允许归档和恢复自己负责的线索</Typography.Text>
              </Flex>
              <Switch checked={permissionRoleDefaults.designer} loading={permissionLoading} onChange={(checked) => setPermissionRoleDefaults((current) => ({ ...current, designer: checked }))} />
            </Flex>
            <Flex justify="space-between" align="center" gap={16} className="rounded-lg bg-muted px-4 py-3">
              <Flex vertical gap={2}>
                <Typography.Text strong>测量员</Typography.Text>
                <Typography.Text type="secondary">默认允许归档和恢复自己录入或负责的线索</Typography.Text>
              </Flex>
              <Switch checked={permissionRoleDefaults.measurer} loading={permissionLoading} onChange={(checked) => setPermissionRoleDefaults((current) => ({ ...current, measurer: checked }))} />
            </Flex>
          </Flex>
          <div className="hidden md:block">
            <ProTable<PermissionStaff>
              rowKey="_id"
              loading={permissionLoading}
              dataSource={permissionStaff}
              search={false}
              options={false}
              pagination={false}
              headerTitle="员工覆盖"
              columns={[
                { title: '员工', key: 'member', render: (_, member) => <Flex vertical gap={2}><Typography.Text strong>{member.displayName || member.username}</Typography.Text><Typography.Text type="secondary" className="text-xs">@{member.username}</Typography.Text></Flex> },
                { title: '岗位', dataIndex: 'role', width: 100, render: (_, member) => <Tag color={ROLE_COLORS[member.role]}>{ROLE_LABELS[member.role]}</Tag> },
                {
                  title: '个人设置',
                  dataIndex: 'effect',
                  width: 160,
                  render: (_, member) => (
                    <Select
                      value={member.effect}
                      className="w-full"
                      options={[
                        { label: '继承角色默认', value: 'inherit' },
                        { label: '单独允许', value: 'allow' },
                        { label: '单独禁止', value: 'deny' },
                      ]}
                      onChange={(effect: PermissionEffect) => setPermissionStaff((current) => current.map((item) => item._id === member._id ? {
                        ...item,
                        effect,
                        effectiveAllowed: effect === 'inherit' ? permissionRoleDefaults[item.role] : effect === 'allow',
                      } : item))}
                    />
                  ),
                },
                {
                  title: '最终权限',
                  key: 'effective',
                  width: 100,
                  render: (_, member) => {
                    const allowed = member.effect === 'inherit' ? permissionRoleDefaults[member.role] : member.effect === 'allow';
                    return <Tag color={allowed ? 'green' : 'default'}>{allowed ? '允许' : '禁止'}</Tag>;
                  },
                },
              ]}
            />
          </div>
          <Flex vertical gap={0} className="md:hidden">
            <Typography.Title level={5} className="!mb-2">员工覆盖</Typography.Title>
            {permissionStaff.map((member) => {
              const allowed = member.effect === 'inherit'
                ? permissionRoleDefaults[member.role]
                : member.effect === 'allow';
              return (
                <Flex key={member._id} vertical gap={10} className="border-b border-border py-4 last:border-b-0">
                  <Flex justify="space-between" align="start" gap={12}>
                    <Flex vertical gap={2} className="min-w-0">
                      <Typography.Text strong>{member.displayName || member.username}</Typography.Text>
                      <Typography.Text type="secondary" className="text-xs" ellipsis>@{member.username}</Typography.Text>
                    </Flex>
                    <Space size={6} wrap>
                      <Tag color={ROLE_COLORS[member.role]}>{ROLE_LABELS[member.role]}</Tag>
                      <Tag color={allowed ? 'green' : 'default'}>{allowed ? '允许' : '禁止'}</Tag>
                    </Space>
                  </Flex>
                  <Select
                    value={member.effect}
                    className="w-full"
                    options={[
                      { label: '继承角色默认', value: 'inherit' },
                      { label: '单独允许', value: 'allow' },
                      { label: '单独禁止', value: 'deny' },
                    ]}
                    onChange={(effect: PermissionEffect) => setPermissionStaff((current) => current.map((item) => item._id === member._id ? {
                      ...item,
                      effect,
                      effectiveAllowed: effect === 'inherit' ? permissionRoleDefaults[item.role] : effect === 'allow',
                    } : item))}
                  />
                </Flex>
              );
            })}
          </Flex>
        </Flex>
      </Drawer>

      <ModalForm<EnterpriseProfileSettings>
        key={profileSettings ? JSON.stringify(profileSettings) : 'profile-settings-loading'}
        title="企业专业背书设置"
        open={profileSettingsOpen}
        loading={profileSettingsLoading}
        initialValues={profileSettings || {
          designerTitle: '金牌设计师',
          measurerTitle: '资深测量师',
          defaultExperienceYears: 7,
          serviceThreshold: 100,
          forceEnterpriseProfile: false,
          titleVisibilityPolicy: 'follow_staff',
        }}
        modalProps={{ destroyOnHidden: true, maskClosable: false, width: 680 }}
        onOpenChange={(open) => setProfileSettingsOpen(open)}
        onFinish={saveProfileSettings}
        submitter={{ searchConfig: { submitText: '保存并全局生效' } }}
      >
        <Alert
          showIcon
          type="info"
          className="mb-5"
          message="企业规则可统一覆盖员工配置"
          description="客户侧不会公开 100 以下的真实服务人数；超过门槛后，员工可选择展示系统准确统计。"
        />
        <Flex gap={16} wrap="wrap">
          <ProFormText width="md" name="designerTitle" label="设计师默认头衔" rules={[{ required: true }, { max: 20 }]} />
          <ProFormText width="md" name="measurerTitle" label="测量员默认头衔" rules={[{ required: true }, { max: 20 }]} />
        </Flex>
        <Flex gap={16} wrap="wrap">
          <ProFormDigit width="md" name="defaultExperienceYears" label="默认经验年限" min={1} max={100} rules={[{ required: true }]} fieldProps={{ precision: 0 }} />
          <ProFormDigit width="md" name="serviceThreshold" label="免费服务客户背书门槛" min={100} max={1000000} rules={[{ required: true }]} fieldProps={{ precision: 0 }} extra="最低为 100；客户侧默认显示为“100+”。" />
        </Flex>
        <ProFormSwitch name="forceEnterpriseProfile" label="强制使用企业统一背书" extra="开启后，企业头衔与经验年限覆盖员工自填内容；单员工管理员头衔仍优先。" />
        <ProFormSelect
          name="titleVisibilityPolicy"
          label="头衔显示规则"
          options={[
            { label: '跟随员工设置', value: 'follow_staff' },
            { label: '企业强制显示', value: 'force_show' },
            { label: '企业强制隐藏', value: 'force_hide' },
          ]}
          rules={[{ required: true }]}
        />
        <Form.Item noStyle shouldUpdate>
          {({ getFieldsValue }) => {
            const values = getFieldsValue() as Partial<EnterpriseProfileSettings>;
            const titleHidden = values.titleVisibilityPolicy === 'force_hide';
            return (
              <Card size="small" title="客户侧预览" className="mt-2">
                {titleHidden
                  ? <Tag>头衔已隐藏</Tag>
                  : <Typography.Text strong>{values.designerTitle || '金牌设计师'}</Typography.Text>}
                <Typography.Text type="secondary">{titleHidden ? '' : ' · '}{values.defaultExperienceYears || 7}年设计经验 · 已免费服务客户{values.serviceThreshold || 100}+</Typography.Text>
              </Card>
            );
          }}
        </Form.Item>
      </ModalForm>

      <ModalForm<StaffProfessionalForm>
        key={professionalProfile ? `${professionalStaff?._id}-${professionalProfile.actualServiceCount}-${professionalProfile.profileLocked}` : 'professional-profile-loading'}
        title={`${professionalStaff?.displayName || professionalStaff?.username || '员工'} · 专业背书`}
        open={professionalProfileOpen}
        loading={professionalProfileLoading}
        initialValues={professionalProfile ? {
          adminTitleOverride: professionalProfile.adminTitleOverride,
          careerStartYear: professionalProfile.careerStartYear,
          titleVisible: professionalProfile.staffTitleVisible,
          profileLocked: professionalProfile.profileLocked,
          showActualServiceCount: professionalProfile.showActualServiceCount,
        } : undefined}
        modalProps={{ destroyOnHidden: true, maskClosable: false, width: 620 }}
        onOpenChange={(open) => { setProfessionalProfileOpen(open); if (!open) setProfessionalStaff(null); }}
        onFinish={saveStaffProfessionalProfile}
        submitter={{ searchConfig: { submitText: '保存员工背书' } }}
      >
        {professionalProfile ? (
          <>
            <Alert
              showIcon
              type={professionalProfile.canShowActualServiceCount ? 'success' : 'info'}
              className="mb-5"
              message={`系统真实服务客户：${professionalProfile.actualServiceCount} 位（仅后台可见）`}
              description={professionalProfile.canShowActualServiceCount
                ? '已超过企业门槛，可以选择在客户侧展示准确数字。'
                : '未超过企业门槛，客户侧只展示企业配置的 100+ 背书。'}
            />
            <ProFormText name="adminTitleOverride" label="单员工专属头衔" rules={[{ max: 20 }]} fieldProps={{ placeholder: '留空则按企业或员工配置计算' }} />
            <ProFormDigit name="careerStartYear" label="从业起始年份" min={1950} max={new Date().getFullYear()} fieldProps={{ precision: 0 }} />
            <ProFormSwitch name="titleVisible" label="员工选择显示头衔" extra={professionalProfile.enterpriseTitleVisibilityPolicy === 'follow_staff' ? '当前企业规则会跟随此开关。' : '当前企业采用强制显示/隐藏规则，此开关会保存但不改变最终展示。'} />
            <ProFormSwitch name="profileLocked" label="锁定员工职业资料" extra="锁定后员工不能自行修改头衔、年份和显示状态。" />
            <ProFormSwitch name="showActualServiceCount" label="展示真实服务人数" disabled={!professionalProfile.canShowActualServiceCount} extra={professionalProfile.canShowActualServiceCount ? '开启后客户侧展示系统准确人数。' : '真实服务人数必须超过企业门槛后才能开启。'} />
            <Card size="small" title="当前客户侧效果">
              {professionalProfile.titleVisible && professionalProfile.title ? <Tag color="green">{professionalProfile.title}</Tag> : <Tag>头衔已隐藏</Tag>}
              <Typography.Text>{professionalProfile.experienceLabel} · {professionalProfile.serviceLabel}</Typography.Text>
            </Card>
          </>
        ) : null}
      </ModalForm>

      <ModalForm<StaffForm>
        key={editingStaff?._id || 'create-staff'}
        title={editingStaff ? '编辑员工' : '新增员工'}
        open={staffFormOpen}
        initialValues={editingStaff ? {
          username: editingStaff.username,
          displayName: editingStaff.displayName || '',
          phone: editingStaff.phone || '',
          role: editingStaff.role,
          departmentId: departmentIdOf(editingStaff) || undefined,
          wechatId: editingStaff.wechatId || undefined,
          assignmentPaused: Boolean(editingStaff.assignmentPaused),
          leadCapacityOverride: editingStaff.leadCapacityOverride || undefined,
        } : { role: 'designer', departmentId: selectedDepartmentId || undefined, assignmentPaused: false }}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => { setStaffFormOpen(open); if (!open) setEditingStaff(null); }}
        onFinish={saveStaff}
        submitter={{ searchConfig: { submitText: editingStaff ? '保存员工' : '创建员工' }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex> }}
      >
        <Alert
          showIcon
          type="info"
          className="mb-5"
          message={editingStaff ? '手机号是员工的主要登录账号' : '新员工初始密码为 123456'}
          description={editingStaff
            ? '内部账号用于手机号关联多个企业账号时的备用登录；修改密码请使用员工列表中的“重置密码”。'
            : '系统会自动生成内部备用账号。员工首次使用手机号和初始密码登录后，必须立即设置新密码。'}
        />
        {editingStaff ? (
          <ProFormText name="username" label="内部备用账号" disabled fieldProps={{ autoComplete: 'username' }} />
        ) : null}
        <ProFormText name="displayName" label="姓名或昵称" rules={[{ required: true, message: '请输入显示名称' }]} />
        <ProFormText
          name="phone"
          label="登录手机号"
          rules={[
            { required: true, message: '请输入登录手机号' },
            { pattern: /^1[3-9]\d{9}$/, message: '请输入 11 位有效手机号' },
          ]}
          fieldProps={{ inputMode: 'tel', maxLength: 11, placeholder: '11 位手机号' }}
        />
        <ProFormSelect name="departmentId" label="所属部门" options={[{ label: '不指定部门', value: '' }, ...departments.map((department) => ({ label: department.name, value: department._id }))]} />
        <ProFormSelect
          name="role"
          label="岗位角色"
          options={staffRoleOptions}
          rules={[{ required: true, message: '请选择岗位角色' }]}
          fieldProps={{ onChange: (value) => setStaffRole(value as StaffRole) }}
        />
        {['designer', 'measurer'].includes(staffRole) ? (
          <ProFormSwitch
            name="assignmentPaused"
            label="暂停自动派单"
            extra="暂停后不会再被自动分配新线索；现有已派线索不受影响。"
          />
        ) : null}
        {staffRole === 'designer' ? (
          <>
            <ProFormDigit
              name="leadCapacityOverride"
              label="个人在手容量覆盖"
              min={1}
              max={100000}
              fieldProps={{ precision: 0, placeholder: '留空则使用企业默认容量' }}
              extra="达到容量后不能抢单，也不参与自动派单。"
            />
            <ProFormText name="wechatId" label="微信号" rules={[{ required: true, message: '请输入设计师微信号' }]} />
            <Form.Item
              label="个人微信二维码"
              required
            >
              <ImageUploadField
                ariaLabel="上传个人微信二维码"
                helpText="支持 JPG、PNG、WebP 或 GIF 格式，图片大小不超过 5MB。"
                previewAlt="个人微信二维码预览"
                uploadSuccessText="个人微信二维码已上传"
                uploadText="上传二维码"
                value={wechatQrPreviewUrl}
                onUpload={async (file) => {
                  const formData = new FormData();
                  formData.append('file', file);
                  const response = await fetch('/api/staff/wechat-qr', { method: 'POST', body: formData });
                  const result = await response.json();
                  if (!response.ok || !result.success) throw new Error(result.error || '个人微信二维码上传失败');
                  setWechatQrAssetId(result.data.assetId);
                  return { previewUrl: result.data.imageUrl };
                }}
                onValueChange={(value) => {
                  setWechatQrPreviewUrl(value);
                  if (!value) setWechatQrAssetId(null);
                }}
              />
            </Form.Item>
          </>
        ) : null}
      </ModalForm>

      <ModalForm<DepartmentForm>
        key={editingDepartment?._id || `create-department-${departmentParentId || 'root'}`}
        title={editingDepartment ? '编辑部门' : '新增部门'}
        open={departmentFormOpen}
        initialValues={{ name: editingDepartment?.name || '', parentId: editingDepartment?.parentId || departmentParentId || undefined }}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => { setDepartmentFormOpen(open); if (!open) { setEditingDepartment(null); setDepartmentParentId(null); } }}
        onFinish={saveDepartment}
        submitter={{ searchConfig: { submitText: '保存部门' }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex> }}
      >
        <ProFormText name="name" label="部门名称" rules={[{ required: true, message: '请输入部门名称' }]} fieldProps={{ placeholder: '例如：华中测量组' }} />
        <ProFormSelect name="parentId" label="上级部门" options={[{ label: '顶级部门', value: '' }, ...departments.filter((department) => department._id !== editingDepartment?._id).map((department) => ({ label: department.name, value: department._id }))]} />
      </ModalForm>
    </div>
  );
}

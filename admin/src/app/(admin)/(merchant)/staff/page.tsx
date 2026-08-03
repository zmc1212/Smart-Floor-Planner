'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Alert, Avatar, Button, Card, Dropdown, Flex, Space, Tag, Tooltip, Tree, Typography, type MenuProps, type TreeDataNode } from 'antd';
import { Ellipsis, FolderPlus, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
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
};

type StaffRole = 'enterprise_admin' | 'designer' | 'measurer' | 'salesperson';

type StaffForm = {
  username: string;
  password?: string;
  displayName: string;
  phone?: string;
  role: StaffRole;
  departmentId?: string;
};

type DepartmentForm = { name: string; parentId?: string };

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

  const canManage = Boolean(currentUser && ['super_admin', 'admin', 'enterprise_admin'].includes(currentUser.role));
  const requiresTenantSelection = Boolean(currentUser && ['super_admin', 'admin'].includes(currentUser.role) && globalTenantId === 'all');
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

  const saveStaff = async (values: StaffForm) => {
    const isEdit = Boolean(editingStaff);
    try {
      const response = await fetch(isEdit ? `/api/staff/${editingStaff?._id}` : '/api/staff', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, departmentId: values.departmentId || '' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存员工失败');
      notify.success(isEdit ? '员工信息已更新' : '员工账号已创建');
      setStaffFormOpen(false);
      setEditingStaff(null);
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
    { title: '联系电话', dataIndex: 'phone', width: 160, hideInSearch: true, render: (value) => value || <Typography.Text type="secondary">未填写</Typography.Text> },
    { title: '所属部门', key: 'department', width: 180, hideInSearch: true, render: (_, member) => <Typography.Text>{departmentNameOf(member, departments)}</Typography.Text> },
    { title: '创建时间', dataIndex: 'createdAt', valueType: 'dateTime', width: 180, hideInSearch: true, render: (_, member) => member.createdAt ? new Date(member.createdAt).toLocaleString() : '-' },
    {
      title: '操作', key: 'actions', valueType: 'option', fixed: 'right', width: 120, hideInSearch: true,
      render: (_, member) => {
        if (!canManage) return [];
        const items: MenuProps['items'] = [
          { key: 'edit', label: '编辑员工', icon: <Pencil size={15} />, onClick: () => { setEditingStaff(member); setStaffFormOpen(true); } },
          { key: 'delete', label: '删除员工', icon: <Trash2 size={15} />, danger: true, onClick: () => { void deleteStaff(member); } },
        ];
        return <Dropdown menu={{ items }} trigger={['click']}><Button aria-label={`${member.displayName || member.username} 更多操作`} icon={<Ellipsis size={18} />} /></Dropdown>;
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
        extra={canManage && !requiresTenantSelection ? [<Button key="create" type="primary" icon={<Plus size={16} />} onClick={() => { setEditingStaff(null); setStaffFormOpen(true); }}>新增员工</Button>] : undefined}
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
        <Flex gap={24} align="start" wrap="wrap">
          <Card title="部门结构" className="admin-panel-card w-full lg:!w-72">
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
            <ProTable<StaffMember>
              actionRef={actionRef}
              rowKey="_id"
              columns={columns}
              search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
              options={{ reload: true, density: true, setting: true }}
              pagination={{ defaultPageSize: 20, showSizeChanger: true }}
              scroll={{ x: 900 }}
              request={async (params) => {
                const query = new URLSearchParams({ page: String(params.current || 1), limit: String(params.pageSize || 20) });
                if (selectedDepartmentId) query.set('departmentId', selectedDepartmentId);
                if (params.search) query.set('search', String(params.search));
                if (params.role) query.set('roles', String(params.role));
                const response = await fetch(`/api/staff?${query}`);
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || '读取员工失败');
                return { data: result.data || [], total: result.pagination?.total || 0, success: true };
              }}
            />
          </div>
        </Flex>
        )}
      </PageContainer>

      <ModalForm<StaffForm>
        key={editingStaff?._id || 'create-staff'}
        title={editingStaff ? '编辑员工' : '新增员工'}
        open={staffFormOpen}
        initialValues={editingStaff ? { username: editingStaff.username, displayName: editingStaff.displayName || '', phone: editingStaff.phone || '', role: editingStaff.role, departmentId: departmentIdOf(editingStaff) || undefined } : { role: 'designer', departmentId: selectedDepartmentId || undefined }}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => { setStaffFormOpen(open); if (!open) setEditingStaff(null); }}
        onFinish={saveStaff}
        submitter={{ searchConfig: { submitText: editingStaff ? '保存员工' : '创建员工' }, render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex> }}
      >
        <ProFormText name="username" label="登录账号" rules={[{ required: true, message: '请输入登录账号' }]} fieldProps={{ autoComplete: 'username', placeholder: '例如：designer_zhang' }} />
        <ProFormText.Password name="password" label={editingStaff ? '重置密码（留空则不修改）' : '登录密码'} rules={editingStaff ? [] : [{ required: true, message: '请输入登录密码' }, { min: 6, message: '密码不少于 6 位' }]} fieldProps={{ autoComplete: 'new-password' }} />
        <ProFormText name="displayName" label="姓名或昵称" rules={[{ required: true, message: '请输入显示名称' }]} />
        <ProFormText name="phone" label="联系电话" fieldProps={{ inputMode: 'tel', placeholder: '11 位手机号' }} />
        <ProFormSelect name="departmentId" label="所属部门" options={[{ label: '不指定部门', value: '' }, ...departments.map((department) => ({ label: department.name, value: department._id }))]} />
        <ProFormSelect name="role" label="岗位角色" options={staffRoleOptions} rules={[{ required: true, message: '请选择岗位角色' }]} />
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

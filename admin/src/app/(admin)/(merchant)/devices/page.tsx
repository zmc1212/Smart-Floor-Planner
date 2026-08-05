'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ModalForm,
  PageContainer,
  ProFormDependency,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProTable,
  type ActionType,
  type ProColumns,
  type ProFormInstance,
} from '@ant-design/pro-components';
import { Button, Flex, Space, Tag, Typography } from 'antd';
import { CircleCheck, PackageOpen, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import ModuleOverview from '@/components/admin/ModuleOverview';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type Reference = {
  _id: string;
  name?: string;
  displayName?: string;
  username?: string;
  role?: string;
  enterpriseId?: string | Reference;
};

type DeviceStatus = 'unassigned' | 'assigned' | 'maintenance' | 'lost';

type Device = {
  _id: string;
  code: string;
  description?: string | null;
  status: DeviceStatus;
  enterpriseId?: string | Reference | null;
  assignedUserId?: string | Reference | null;
  createdAt?: string;
};

type DeviceForm = {
  code: string;
  description?: string;
  enterpriseId?: string;
  assignedUserId?: string;
  status?: DeviceStatus;
};

type CurrentUser = {
  role?: string;
  enterpriseId?: string | Reference | null;
};

const UNASSIGNED_VALUE = '__unassigned__';

const STATUS_OPTIONS: Array<{ value: DeviceStatus; label: string }> = [
  { value: 'unassigned', label: '闲置' },
  { value: 'assigned', label: '已绑定' },
  { value: 'maintenance', label: '维护中' },
  { value: 'lost', label: '遗失' },
];

function getReferenceId(value?: string | Reference | null) {
  if (!value) return '';
  return typeof value === 'string' ? value : value._id;
}

function getReferenceName(value?: string | Reference | null) {
  if (!value || typeof value === 'string') return '';
  return value.displayName || value.username || value.name || '';
}

function getRoleLabel(role?: string) {
  const labels: Record<string, string> = {
    designer: '设计师',
    salesperson: '渠道地推',
    measurer: '量房师',
    enterprise_admin: '企业管理员',
  };
  return labels[role || ''] || role || '员工';
}

function getStatusLabel(status: DeviceStatus) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
}

function getStatusColor(status: DeviceStatus) {
  if (status === 'assigned') return 'green';
  if (status === 'maintenance') return 'orange';
  if (status === 'lost') return 'red';
  return 'default';
}

function formatCreatedAt(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export default function DevicesPage() {
  const actionRef = useRef<ActionType>(null);
  const formRef = useRef<ProFormInstance<DeviceForm>>(null);
  const confirmAction = useConfirmDialog();
  const { user: rawCurrentUser } = useCurrentUser();
  const currentUser = rawCurrentUser as CurrentUser | null;
  const [staff, setStaff] = useState<Reference[]>([]);
  const [enterprises, setEnterprises] = useState<Reference[]>([]);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [overview, setOverview] = useState({ total: 0, assigned: 0, maintenance: 0, unassigned: 0 });

  const canManage = ['super_admin', 'admin', 'enterprise_admin'].includes(currentUser?.role || '');
  const canChangeEnterprise = ['super_admin', 'admin'].includes(currentUser?.role || '');

  const fetchStaff = useCallback(async () => {
    try {
      const [staffResponse, promoterResponse] = await Promise.all([
        fetch('/api/staff?limit=50'),
        fetch('/api/staff?scope=unassigned-promoters&limit=50'),
      ]);
      const [staffResult, promoterResult] = await Promise.all([
        staffResponse.json(),
        promoterResponse.json(),
      ]);
      const staffById = new Map(
        [
          ...(staffResponse.ok && staffResult.success ? staffResult.data || [] : []),
          ...(promoterResponse.ok && promoterResult.success ? promoterResult.data || [] : []),
        ].map((member: Reference) => [member._id, member])
      );
      setStaff(Array.from(staffById.values()));
    } catch {
      // Editing remains available when optional assignment choices cannot load.
    }
  }, []);

  const fetchEnterprises = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/enterprises');
      const result = await response.json();
      if (response.ok && result.success) setEnterprises(result.data || []);
    } catch {
      // Enterprise choices are available only to platform administrators.
    }
  }, []);

  useEffect(() => {
    void fetchStaff();
  }, [fetchStaff]);

  useEffect(() => {
    if (canChangeEnterprise) void fetchEnterprises();
  }, [canChangeEnterprise, fetchEnterprises]);

  const enterpriseOptions = useMemo(
    () => [
      { label: '未分配企业', value: UNASSIGNED_VALUE },
      ...enterprises.map((enterprise) => ({
        label: getReferenceName(enterprise) || enterprise._id,
        value: enterprise._id,
      })),
    ],
    [enterprises]
  );

  const getStaffOptions = useCallback(
    (enterpriseId?: string) => {
      const resolvedEnterpriseId = enterpriseId === UNASSIGNED_VALUE ? '' : enterpriseId || '';
      const visibleStaff = !resolvedEnterpriseId
        ? staff
        : staff.filter((member) => getReferenceId(member.enterpriseId) === resolvedEnterpriseId);
      return [
        { label: '未指定人员', value: UNASSIGNED_VALUE },
        ...visibleStaff.map((member) => ({
          label: `${getReferenceName(member) || member._id}（${getRoleLabel(member.role)}）`,
          value: member._id,
        })),
      ];
    },
    [staff]
  );

  const saveDevice = async (values: DeviceForm) => {
    const isEdit = Boolean(editingDevice);
    const enterpriseId = values.enterpriseId === UNASSIGNED_VALUE ? null : values.enterpriseId || null;
    const assignedUserId = values.assignedUserId === UNASSIGNED_VALUE ? null : values.assignedUserId || null;
    const payload = isEdit
      ? {
          code: values.code.trim(),
          description: values.description?.trim() || '',
          enterpriseId: canChangeEnterprise ? enterpriseId : undefined,
          assignedUserId,
          status: values.status,
        }
      : {
          code: values.code.trim(),
          description: values.description?.trim() || '',
          enterpriseId: currentUser?.role === 'enterprise_admin' ? getReferenceId(currentUser.enterpriseId) : undefined,
          status: currentUser?.role === 'enterprise_admin' ? 'assigned' : 'unassigned',
        };
    try {
      const response = await fetch(isEdit ? `/api/devices/${editingDevice?._id}` : '/api/devices', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '设备保存失败');
      notify.success(isEdit ? '设备已更新' : '设备已录入');
      setFormOpen(false);
      setEditingDevice(null);
      await actionRef.current?.reload();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '设备保存失败');
      return false;
    }
  };

  const deleteDevice = async (device: Device) => {
    if (deletingId) return;
    const confirmed = await confirmAction({
      title: '删除设备',
      description: `确定删除设备“${device.code}”吗？删除后无法恢复。`,
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingId(device._id);
    try {
      const response = await fetch(`/api/devices/${device._id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除设备失败');
      notify.success('设备已删除');
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除设备失败');
    } finally {
      setDeletingId(null);
    }
  };

  const columns: ProColumns<Device>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '设备编码或备注', allowClear: true },
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label])),
      width: 120,
      render: (_, item) => <Tag color={getStatusColor(item.status)}>{getStatusLabel(item.status)}</Tag>,
    },
    {
      title: '设备编码',
      dataIndex: 'code',
      hideInSearch: true,
      width: 260,
      render: (_, item) => (
        <Flex vertical gap={4}>
          <Typography.Text strong code>{item.code}</Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: item.description || '无备注' }} className="text-xs">
            {item.description || '无备注'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '归属企业',
      key: 'enterprise',
      hideInSearch: true,
      width: 220,
      render: (_, item) => getReferenceName(item.enterpriseId) || '未分配企业',
    },
    {
      title: '持有人',
      key: 'assignee',
      hideInSearch: true,
      width: 200,
      render: (_, item) => getReferenceName(item.assignedUserId) || '未指定人员',
    },
    {
      title: '录入时间',
      dataIndex: 'createdAt',
      hideInSearch: true,
      width: 190,
      render: (_, item) => formatCreatedAt(item.createdAt),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 180,
      hideInSearch: true,
      render: (_, item) => {
        if (!canManage) return '-';
        const isDeleting = deletingId === item._id;
        return (
          <Space size={8}>
            <Button size="small" icon={<Pencil size={14} />} onClick={() => { setEditingDevice(item); setFormOpen(true); }}>
              编辑
            </Button>
            <Button size="small" danger loading={isDeleting} disabled={isDeleting} icon={<Trash2 size={14} />} onClick={() => void deleteDevice(item)}>
              删除
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="测距仪设备池"
        content="维护设备资产、企业归属、员工绑定与运行状态。"
        extra={canManage ? [
          <Button key="create" type="primary" icon={<Plus size={16} />} onClick={() => { setEditingDevice(null); setFormOpen(true); }}>
            录入设备
          </Button>,
        ] : undefined}
      >
        <ModuleOverview
          ariaLabel="设备池概览"
          items={[
            { label: '当前筛选设备', value: overview.total, icon: <PackageOpen size={18} /> },
            { label: '已绑定人员', value: overview.assigned, icon: <CircleCheck size={18} />, tone: 'success' },
            { label: '维护处理中', value: overview.maintenance, icon: <Wrench size={18} />, tone: 'warning' },
            { label: '待分配设备', value: overview.unassigned, icon: <PackageOpen size={18} /> },
          ]}
        />
        <ProTable<Device>
          className="admin-data-table admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1120 }}
          request={async (params) => {
            const response = await fetch('/api/devices');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '设备列表加载失败');
            const keyword = String(params.keyword || '').trim().toLocaleLowerCase();
            const rows = (result.data || []).filter((item: Device) => {
              const matchesKeyword = !keyword || [item.code, item.description]
                .filter(Boolean)
                .some((value) => value?.toLocaleLowerCase().includes(keyword));
              return matchesKeyword && (!params.status || item.status === params.status);
            });
            const nextOverview = {
              total: rows.length,
              assigned: rows.filter((item: Device) => item.status === 'assigned').length,
              maintenance: rows.filter((item: Device) => item.status === 'maintenance').length,
              unassigned: rows.filter((item: Device) => item.status === 'unassigned').length,
            };
            setOverview((current) => (
              current.total === nextOverview.total &&
              current.assigned === nextOverview.assigned &&
              current.maintenance === nextOverview.maintenance &&
              current.unassigned === nextOverview.unassigned
                ? current
                : nextOverview
            ));
            const pageSize = Number(params.pageSize || 20);
            const current = Number(params.current || 1);
            return {
              data: rows.slice((current - 1) * pageSize, current * pageSize),
              total: rows.length,
              success: true,
            };
          }}
          onRequestError={(error) => notify.error(error instanceof Error ? error.message : '设备列表加载失败')}
        />
      </PageContainer>

      <ModalForm<DeviceForm>
        key={editingDevice?._id || 'create-device'}
        formRef={formRef}
        title={editingDevice ? '编辑设备' : '录入设备'}
        open={formOpen}
        initialValues={editingDevice ? {
          code: editingDevice.code,
          description: editingDevice.description || '',
          enterpriseId: getReferenceId(editingDevice.enterpriseId) || UNASSIGNED_VALUE,
          assignedUserId: getReferenceId(editingDevice.assignedUserId) || UNASSIGNED_VALUE,
          status: editingDevice.status,
        } : {
          status: 'unassigned',
        }}
        modalProps={{ destroyOnHidden: true, maskClosable: false }}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingDevice(null);
        }}
        onValuesChange={(changedValues, allValues) => {
          const updates: Partial<DeviceForm> = {};
          if ('enterpriseId' in changedValues) {
            updates.assignedUserId = UNASSIGNED_VALUE;
            if (
              changedValues.enterpriseId === UNASSIGNED_VALUE &&
              allValues.status === 'assigned'
            ) {
              updates.status = 'unassigned';
            }
          }
          if (
            'assignedUserId' in changedValues &&
            changedValues.assignedUserId !== UNASSIGNED_VALUE &&
            allValues.status === 'unassigned'
          ) {
            updates.status = 'assigned';
          }
          if (Object.keys(updates).length > 0) {
            formRef.current?.setFieldsValue(updates);
          }
        }}
        onFinish={saveDevice}
        submitter={{
          searchConfig: { submitText: editingDevice ? '保存设备' : '确认录入' },
          render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex>,
        }}
      >
        <ProFormText
          name="code"
          label="设备编码 / MAC"
          rules={[{ required: true, message: '请输入设备编码或 MAC' }]}
          fieldProps={{ placeholder: '例如：SN-123456', className: 'font-mono' }}
        />
        <ProFormTextArea name="description" label="备注" fieldProps={{ rows: 3, placeholder: '例如：杭州分公司备机' }} />
        {editingDevice && canChangeEnterprise ? (
          <ProFormSelect name="enterpriseId" label="归属企业" options={enterpriseOptions} />
        ) : null}
        {editingDevice ? (
          <ProFormDependency name={['enterpriseId']}>
            {({ enterpriseId }) => (
              <ProFormSelect
                name="assignedUserId"
                label="持有人"
                options={getStaffOptions(enterpriseId)}
                fieldProps={{ placeholder: '未指定人员' }}
              />
            )}
          </ProFormDependency>
        ) : null}
        {editingDevice ? (
          <ProFormSelect name="status" label="状态" options={STATUS_OPTIONS} rules={[{ required: true, message: '请选择设备状态' }]} />
        ) : null}
      </ModalForm>
    </div>
  );
}

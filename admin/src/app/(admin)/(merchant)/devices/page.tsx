'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react';
import {
  ModalForm,
  PageContainer,
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
import { notify } from '@/components/admin/operation-feedback';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  compactDeviceIdentity,
  matchesDeviceSerialNumber,
} from '@/lib/device-serial-number';

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
  serialNumber?: string | null;
  description?: string | null;
  status: DeviceStatus;
  enterpriseId?: string | Reference | null;
  createdAt?: string;
};

type DeviceForm = {
  code: string;
  serialNumber?: string;
  description?: string;
  enterpriseId?: string;
  status?: DeviceStatus;
};

type CurrentUser = {
  role?: string;
  enterpriseId?: string | Reference | null;
};

const UNASSIGNED_VALUE = '__unassigned__';

const STATUS_OPTIONS: Array<{ value: DeviceStatus; label: string }> = [
  { value: 'unassigned', label: '闲置' },
  { value: 'assigned', label: '已分配企业' },
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
  const [enterprises, setEnterprises] = useState<Reference[]>([]);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [overview, setOverview] = useState({
    total: 0,
    assigned: 0,
    maintenance: 0,
    unassigned: 0,
  });

  const canManage = ['super_admin', 'admin'].includes(currentUser?.role || '');
  const canChangeEnterprise = canManage;

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

  const saveDevice = async (values: DeviceForm) => {
    const isEdit = Boolean(editingDevice);
    const enterpriseId =
      values.enterpriseId === UNASSIGNED_VALUE
        ? null
        : values.enterpriseId || null;
    const payload = isEdit
      ? {
          code: values.code.trim(),
          serialNumber: values.serialNumber?.trim() || '',
          description: values.description?.trim() || '',
          enterpriseId: canChangeEnterprise ? enterpriseId : undefined,
          status: values.status,
        }
      : {
          code: values.code.trim(),
          serialNumber: values.serialNumber?.trim() || '',
          description: values.description?.trim() || '',
          enterpriseId,
          status: enterpriseId ? 'assigned' : 'unassigned',
        };
    try {
      const response = await fetch(
        isEdit ? `/api/devices/${editingDevice?._id}` : '/api/devices',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '设备保存失败');
      }
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
      const response = await fetch(`/api/devices/${device._id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '删除设备失败');
      }
      notify.success('设备已删除');
      setSelectedRowKeys((keys) => keys.filter((key) => key !== device._id));
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除设备失败');
    } finally {
      setDeletingId(null);
    }
  };

  const deleteSelectedDevices = async () => {
    if (!selectedRowKeys.length || deletingSelected) return;
    const confirmed = await confirmAction({
      title: '批量删除设备',
      description: `确定删除已选的 ${selectedRowKeys.length} 台设备吗？删除后无法恢复。`,
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingSelected(true);
    try {
      const response = await fetch('/api/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '批量删除设备失败');
      }
      const deletedCount = Number(result.data?.deletedCount || 0);
      notify.success(`已删除 ${deletedCount} 台设备`);
      setSelectedRowKeys([]);
      await actionRef.current?.reload();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '批量删除设备失败');
    } finally {
      setDeletingSelected(false);
    }
  };

  const columns: ProColumns<Device>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '设备编码、SN 码或备注', allowClear: true },
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(
        STATUS_OPTIONS.map((item) => [item.value, item.label])
      ),
      width: 120,
      render: (_, item) => (
        <Tag color={getStatusColor(item.status)}>
          {getStatusLabel(item.status)}
        </Tag>
      ),
    },
    ...(canManage
      ? [
          {
            title: '归属企业',
            dataIndex: 'enterpriseId',
            valueType: 'select' as const,
            hideInTable: true,
            fieldProps: {
              options: enterpriseOptions,
              placeholder: '全部企业',
              allowClear: true,
            },
          } satisfies ProColumns<Device>,
        ]
      : []),
    {
      title: '设备编码 / MAC',
      dataIndex: 'code',
      hideInSearch: true,
      width: 260,
      render: (_, item) => (
        <Flex vertical gap={4}>
          <Typography.Text strong code>
            {item.code}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: item.description || '无备注' }}
            className="text-xs"
          >
            {item.description || '无备注'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: 'SN 码',
      dataIndex: 'serialNumber',
      width: 180,
      fieldProps: {
        placeholder: '支持部分匹配，可省略横线空格',
        allowClear: true,
      },
      render: (_, item) =>
        item.serialNumber ? (
          <Typography.Text code className="font-mono">
            {item.serialNumber}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">未录入</Typography.Text>
        ),
    },
    {
      title: '归属企业',
      key: 'enterprise',
      hideInSearch: true,
      width: 220,
      render: (_, item) =>
        getReferenceName(item.enterpriseId) || '未分配企业',
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
            <Button
              size="small"
              icon={<Pencil size={14} />}
              onClick={() => {
                setEditingDevice(item);
                setFormOpen(true);
              }}
            >
              编辑
            </Button>
            <Button
              size="small"
              danger
              loading={isDeleting}
              disabled={isDeleting}
              icon={<Trash2 size={14} />}
              onClick={() => void deleteDevice(item)}
            >
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
        title={canManage ? '测距仪设备池' : '企业设备列表'}
        content={
          canManage
            ? '平台录入测距仪 MAC、SN 码、分配企业与维护运行状态。企业侧仅可查看本企业设备。'
            : '查看本企业已分配的测距仪设备。设备录入与分配由平台管理员完成。'
        }
        extra={
          canManage
            ? [
                <Button
                  key="create"
                  type="primary"
                  icon={<Plus size={16} />}
                  onClick={() => {
                    setEditingDevice(null);
                    setFormOpen(true);
                  }}
                >
                  录入设备
                </Button>,
              ]
            : undefined
        }
      >
        <ModuleOverview
          ariaLabel="设备池概览"
          items={[
            {
              label: '当前筛选设备',
              value: overview.total,
              icon: <PackageOpen size={18} />,
            },
            {
              label: '已分配企业',
              value: overview.assigned,
              icon: <CircleCheck size={18} />,
              tone: 'success',
            },
            {
              label: '维护处理中',
              value: overview.maintenance,
              icon: <Wrench size={18} />,
              tone: 'warning',
            },
            {
              label: '待分配设备',
              value: overview.unassigned,
              icon: <PackageOpen size={18} />,
            },
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
          scroll={{ x: 1080 }}
          rowSelection={
            canManage
              ? {
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys),
                  preserveSelectedRowKeys: true,
                }
              : undefined
          }
          tableAlertRender={
            canManage
              ? ({ selectedRowKeys: keys }) => `已选择 ${keys.length} 台设备`
              : false
          }
          tableAlertOptionRender={
            canManage
              ? () => (
                  <Button
                    danger
                    icon={<Trash2 size={16} />}
                    loading={deletingSelected}
                    onClick={() => void deleteSelectedDevices()}
                  >
                    批量删除
                  </Button>
                )
              : undefined
          }
          request={async (params) => {
            const response = await fetch('/api/devices');
            const result = await response.json();
            if (!response.ok || !result.success) {
              throw new Error(result.error || '设备列表加载失败');
            }
            const keyword = String(params.keyword || '')
              .trim()
              .toLocaleLowerCase();
            const compactKeyword = compactDeviceIdentity(keyword);
            const serialQuery = String(params.serialNumber || '').trim();
            const enterpriseId = String(params.enterpriseId || '');
            const rows = (result.data || []).filter((item: Device) => {
              const matchesKeyword =
                !keyword ||
                [item.code, item.serialNumber, item.description]
                  .filter(Boolean)
                  .some(
                    (value) =>
                      value?.toLocaleLowerCase().includes(keyword) ||
                      (compactKeyword.length > 0 &&
                        compactDeviceIdentity(value).includes(compactKeyword))
                  );
              return (
                matchesKeyword &&
                matchesDeviceSerialNumber(item.serialNumber, serialQuery) &&
                (!params.status || item.status === params.status) &&
                (!enterpriseId ||
                  (enterpriseId === UNASSIGNED_VALUE
                    ? !getReferenceId(item.enterpriseId)
                    : getReferenceId(item.enterpriseId) === enterpriseId))
              );
            });
            const nextOverview = {
              total: rows.length,
              assigned: rows.filter(
                (item: Device) => item.status === 'assigned'
              ).length,
              maintenance: rows.filter(
                (item: Device) => item.status === 'maintenance'
              ).length,
              unassigned: rows.filter(
                (item: Device) => item.status === 'unassigned'
              ).length,
            };
            setOverview((current) =>
              current.total === nextOverview.total &&
              current.assigned === nextOverview.assigned &&
              current.maintenance === nextOverview.maintenance &&
              current.unassigned === nextOverview.unassigned
                ? current
                : nextOverview
            );
            const pageSize = Number(params.pageSize || 20);
            const current = Number(params.current || 1);
            return {
              data: rows.slice((current - 1) * pageSize, current * pageSize),
              total: rows.length,
              success: true,
            };
          }}
          onRequestError={(error) =>
            notify.error(
              error instanceof Error ? error.message : '设备列表加载失败'
            )
          }
        />
      </PageContainer>

      {canManage ? (
        <ModalForm<DeviceForm>
          key={editingDevice?._id || 'create-device'}
          formRef={formRef}
          title={editingDevice ? '编辑设备' : '录入设备'}
          open={formOpen}
          initialValues={
            editingDevice
              ? {
                  code: editingDevice.code,
                  serialNumber: editingDevice.serialNumber || '',
                  description: editingDevice.description || '',
                  enterpriseId:
                    getReferenceId(editingDevice.enterpriseId) ||
                    UNASSIGNED_VALUE,
                  status: editingDevice.status,
                }
              : {
                  status: 'unassigned',
                  enterpriseId: UNASSIGNED_VALUE,
                }
          }
          modalProps={{ destroyOnHidden: true, maskClosable: false }}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) setEditingDevice(null);
          }}
          onValuesChange={(changedValues, allValues) => {
            const updates: Partial<DeviceForm> = {};
            if (
              'enterpriseId' in changedValues &&
              changedValues.enterpriseId === UNASSIGNED_VALUE &&
              allValues.status === 'assigned'
            ) {
              updates.status = 'unassigned';
            }
            if (
              'enterpriseId' in changedValues &&
              changedValues.enterpriseId &&
              changedValues.enterpriseId !== UNASSIGNED_VALUE &&
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
            searchConfig: {
              submitText: editingDevice ? '保存设备' : '确认录入',
            },
            render: (_, dom) => (
              <Flex justify="end" gap={12} style={{ marginTop: 24 }}>
                {dom}
              </Flex>
            ),
          }}
        >
          <ProFormText
            name="code"
            label="设备编码 / MAC"
            rules={[{ required: true, message: '请输入设备 MAC（BLE deviceId）' }]}
            fieldProps={{
              placeholder: '例如：5C:FF:30:27:A4:00',
              className: 'font-mono',
            }}
          />
          <ProFormText
            name="serialNumber"
            label="SN 码"
            fieldProps={{
              placeholder: '机身标签上的序列号，可选',
              className: 'font-mono',
              maxLength: 64,
            }}
          />
          <ProFormTextArea
            name="description"
            label="备注"
            fieldProps={{ rows: 3, placeholder: '例如：杭州分公司备机' }}
          />
          <ProFormSelect
            name="enterpriseId"
            label="归属企业"
            options={enterpriseOptions}
          />
          {editingDevice ? (
            <ProFormSelect
              name="status"
              label="状态"
              options={STATUS_OPTIONS}
              rules={[{ required: true, message: '请选择设备状态' }]}
            />
          ) : null}
        </ModalForm>
      ) : null}
    </div>
  );
}

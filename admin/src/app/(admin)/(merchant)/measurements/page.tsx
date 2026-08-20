'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PageContainer,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Tag, Typography } from 'antd';
import { Bluetooth, ChartNoAxesCombined, Ruler, ScanLine } from 'lucide-react';
import ModuleOverview from '@/components/admin/ModuleOverview';
import { notify } from '@/components/admin/operation-feedback';

interface MeasurementItem {
  _id: string;
  measuredAt: string;
  operatorId?: { _id: string; displayName?: string; username?: string; role?: string };
  enterpriseId?: { _id: string; name?: string };
  floorPlanId?: { _id: string; name?: string; status?: string };
  roomName?: string;
  roomId?: string;
  deviceId?: string;
  value: number;
  unit: string;
  type: string;
  direction?: string;
  source?: string;
}

interface NamedOption {
  _id: string;
  displayName?: string;
  username?: string;
  name?: string;
  code?: string;
}

const TYPE_LABELS: Record<string, string> = {
  length: '边长',
  height: '层高',
  area: '面积',
  volume: '体积',
  angle: '角度',
  opening_offset: '门窗偏移',
  opening_width: '门窗宽度',
};

const DIRECTION_LABELS: Record<string, string> = {
  E: '东向',
  S: '南向',
  W: '西向',
  N: '北向',
  ANGLE: '斜边',
  top: '上墙',
  right: '右墙',
  bottom: '下墙',
  left: '左墙',
};

const SOURCE_LABELS: Record<string, string> = {
  ble: '蓝牙测距',
  manual: '手动录入',
  system: '系统写入',
};

function getName(value: NamedOption | string | null | undefined, fallback = '-') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value.displayName || value.username || value.name || fallback;
}

function formatTime(value: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatValue(item: MeasurementItem) {
  const value = Number(item.value || 0);
  return `${value.toFixed(2)} ${item.unit || 'meters'}`;
}

function formatDirection(value?: string) {
  if (!value) return '-';
  if (/^P\d+$/.test(value)) return `多边形墙 ${Number(value.slice(1)) + 1}`;
  return DIRECTION_LABELS[value] || value;
}

export default function MeasurementsPage() {
  const actionRef = useRef<ActionType>(null);
  const [staff, setStaff] = useState<NamedOption[]>([]);
  const [floorPlans, setFloorPlans] = useState<NamedOption[]>([]);
  const [devices, setDevices] = useState<NamedOption[]>([]);
  const [overview, setOverview] = useState({ total: 0, ble: 0, manual: 0, floorPlans: 0 });

  useEffect(() => {
    let cancelled = false;
    async function loadFilters() {
      const [staffResult, planResult, deviceResult] = await Promise.allSettled([
        fetch('/api/staff').then((response) => response.json()),
        fetch('/api/floorplans').then((response) => response.json()),
        fetch('/api/devices').then((response) => response.json()),
      ]);
      if (cancelled) return;
      if (staffResult.status === 'fulfilled' && staffResult.value.success) setStaff(staffResult.value.data || []);
      if (planResult.status === 'fulfilled' && planResult.value.success) setFloorPlans(planResult.value.data || []);
      if (deviceResult.status === 'fulfilled' && deviceResult.value.success) setDevices(deviceResult.value.data || []);
    }
    void loadFilters();
    return () => {
      cancelled = true;
    };
  }, []);

  const staffValueEnum = useMemo(
    () => Object.fromEntries(staff.map((member) => [member._id, member.displayName || member.username || member._id])),
    [staff]
  );
  const floorPlanValueEnum = useMemo(
    () => Object.fromEntries(floorPlans.map((plan) => [plan._id, plan.name || '未命名户型'])),
    [floorPlans]
  );
  const deviceValueEnum = useMemo(
    () => Object.fromEntries(devices.map((device) => [device.code || device._id, device.code || device.name || device._id])),
    [devices]
  );

  const columns: ProColumns<MeasurementItem>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '人员、户型、房间或设备', allowClear: true },
    },
    {
      title: '测量类型',
      dataIndex: 'type',
      valueType: 'select',
      valueEnum: TYPE_LABELS,
      width: 130,
      render: (_, item) => <Tag>{TYPE_LABELS[item.type] || item.type}</Tag>,
    },
    {
      title: '操作员工',
      dataIndex: 'operatorId',
      valueType: 'select',
      valueEnum: staffValueEnum,
      width: 160,
      render: (_, item) => getName(item.operatorId),
    },
    {
      title: '正式户型',
      dataIndex: 'floorPlanId',
      valueType: 'select',
      valueEnum: floorPlanValueEnum,
      width: 220,
      render: (_, item) => (
        <Typography.Text ellipsis={{ tooltip: getName(item.floorPlanId) }}>
          {getName(item.floorPlanId)}
        </Typography.Text>
      ),
    },
    {
      title: '测距设备',
      dataIndex: 'deviceId',
      valueType: 'select',
      valueEnum: deviceValueEnum,
      width: 170,
      render: (_, item) => <Typography.Text code>{item.deviceId || '-'}</Typography.Text>,
    },
    {
      title: '时间',
      dataIndex: 'measuredAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 150,
      render: (_, item) => formatTime(item.measuredAt),
    },
    {
      title: '企业',
      key: 'enterprise',
      hideInSearch: true,
      width: 170,
      render: (_, item) => getName(item.enterpriseId),
    },
    {
      title: '房间',
      key: 'room',
      hideInSearch: true,
      width: 180,
      render: (_, item) => item.roomName || item.roomId || '未归属房间',
    },
    {
      title: '来源',
      dataIndex: 'source',
      valueType: 'select',
      valueEnum: SOURCE_LABELS,
      width: 120,
      render: (_, item) => <Tag color={item.source === 'ble' ? 'green' : 'default'}>{SOURCE_LABELS[item.source || ''] || item.source || '-'}</Tag>,
    },
    {
      title: '方向',
      dataIndex: 'direction',
      hideInSearch: true,
      width: 130,
      render: (_, item) => formatDirection(item.direction),
    },
    {
      title: '数值',
      key: 'value',
      hideInSearch: true,
      fixed: 'right',
      width: 140,
      align: 'right',
      render: (_, item) => <Typography.Text strong code>{formatValue(item)}</Typography.Text>,
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="量房记录"
        content="查看正式户型的独立测量审计事件，最多展示符合条件的 100 条记录。"
      >
        <ModuleOverview
          ariaLabel="量房审计概览"
          items={[
            { label: '当前筛选记录', value: overview.total, icon: <ChartNoAxesCombined size={18} /> },
            { label: '蓝牙测距', value: overview.ble, icon: <Bluetooth size={18} />, tone: 'success' },
            { label: '手动录入', value: overview.manual, icon: <Ruler size={18} />, tone: 'warning' },
            { label: '关联户型', value: overview.floorPlans, icon: <ScanLine size={18} /> },
          ]}
        />
        <ProTable<MeasurementItem>
          className="admin-data-table admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          pagination={false}
          scroll={{ x: 1700 }}
          request={async (params) => {
            const query = new URLSearchParams({ limit: '100' });
            if (params.type) query.set('type', String(params.type));
            if (params.operatorId) query.set('operatorId', String(params.operatorId));
            if (params.floorPlanId) query.set('floorPlanId', String(params.floorPlanId));
            if (params.deviceId) query.set('deviceId', String(params.deviceId));
            const response = await fetch(`/api/measurements?${query.toString()}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '量房记录加载失败');
            const keyword = String(params.keyword || '').trim().toLocaleLowerCase();
            const rows = (result.data || []).filter((item: MeasurementItem) => {
              const matchesKeyword = !keyword || [
                getName(item.operatorId),
                getName(item.enterpriseId),
                getName(item.floorPlanId),
                item.roomName,
                item.roomId,
                item.deviceId,
                item.type,
                item.direction,
                item.source,
              ].filter(Boolean).join(' ').toLocaleLowerCase().includes(keyword);
              return matchesKeyword && (!params.source || item.source === params.source);
            });
            const nextOverview = {
              total: rows.length,
              ble: rows.filter((item: MeasurementItem) => item.source === 'ble').length,
              manual: rows.filter((item: MeasurementItem) => item.source === 'manual').length,
              floorPlans: new Set(rows.map((item: MeasurementItem) => item.floorPlanId?._id).filter(Boolean)).size,
            };
            setOverview((current) => (
              current.total === nextOverview.total &&
              current.ble === nextOverview.ble &&
              current.manual === nextOverview.manual &&
              current.floorPlans === nextOverview.floorPlans
                ? current
                : nextOverview
            ));
            return { data: rows, total: rows.length, success: true };
          }}
          onRequestError={(error) => notify.error(error instanceof Error ? error.message : '量房记录加载失败')}
        />
      </PageContainer>
    </div>
  );
}

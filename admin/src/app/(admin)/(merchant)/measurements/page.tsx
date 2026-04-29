'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Filter, RefreshCw, Ruler } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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

const TYPE_LABELS: Record<string, string> = {
  length: '边长',
  height: '层高',
  area: '面积',
  volume: '体积',
  angle: '角度',
};

const DIRECTION_LABELS: Record<string, string> = {
  E: '东向',
  S: '南向',
  W: '西向',
  N: '北向',
  ANGLE: '斜边',
};

function getName(value: any, fallback = '-') {
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
  if (item.type === 'angle') return `${value.toFixed(2)} ${item.unit || 'm'}`;
  return `${value.toFixed(2)} ${item.unit || 'meters'}`;
}

export default function MeasurementsPage() {
  const [items, setItems] = useState<MeasurementItem[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [floorPlans, setFloorPlans] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('all');
  const [operatorId, setOperatorId] = useState('all');
  const [floorPlanId, setFloorPlanId] = useState('all');
  const [deviceId, setDeviceId] = useState('all');
  const [search, setSearch] = useState('');

  const fetchFilters = async () => {
    const [staffRes, planRes, deviceRes] = await Promise.allSettled([
      fetch('/api/staff').then((res) => res.json()),
      fetch('/api/floorplans').then((res) => res.json()),
      fetch('/api/devices').then((res) => res.json()),
    ]);

    if (staffRes.status === 'fulfilled' && staffRes.value.success) setStaff(staffRes.value.data || []);
    if (planRes.status === 'fulfilled' && planRes.value.success) setFloorPlans(planRes.value.data || []);
    if (deviceRes.status === 'fulfilled' && deviceRes.value.success) setDevices(deviceRes.value.data || []);
  };

  const fetchMeasurements = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (type !== 'all') params.set('type', type);
      if (operatorId !== 'all') params.set('operatorId', operatorId);
      if (floorPlanId !== 'all') params.set('floorPlanId', floorPlanId);
      if (deviceId !== 'all') params.set('deviceId', deviceId);

      const res = await fetch(`/api/measurements?${params.toString()}`);
      const data = await res.json();
      if (data.success) setItems(data.data || []);
    } catch (error) {
      console.error('Fetch measurements failed:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilters();
  }, []);

  useEffect(() => {
    fetchMeasurements();
  }, [type, operatorId, floorPlanId, deviceId]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;

    return items.filter((item) => {
      const haystack = [
        getName(item.operatorId),
        getName(item.enterpriseId),
        getName(item.floorPlanId),
        item.roomName,
        item.roomId,
        item.deviceId,
        item.type,
        item.direction,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [items, search]);

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Ruler size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">量房记录</h1>
              <p className="mt-1 text-sm text-muted-foreground">查看激光测距仪写入的独立测量事件</p>
            </div>
          </div>
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={fetchMeasurements}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        </div>

        <div className="mb-6 grid gap-3 rounded-2xl border bg-muted/20 p-3 md:grid-cols-5">
          <div className="relative md:col-span-1">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索记录"
              className="h-10 rounded-xl border-none bg-white pl-9"
            />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-10 rounded-xl border-none bg-white">
              <SelectValue placeholder="测量类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="length">边长</SelectItem>
              <SelectItem value="height">层高</SelectItem>
              <SelectItem value="angle">角度/斜边</SelectItem>
            </SelectContent>
          </Select>
          <Select value={operatorId} onValueChange={setOperatorId}>
            <SelectTrigger className="h-10 rounded-xl border-none bg-white">
              <SelectValue placeholder="员工" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部员工</SelectItem>
              {staff.map((member) => (
                <SelectItem key={member._id} value={String(member._id)}>
                  {member.displayName || member.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={floorPlanId} onValueChange={setFloorPlanId}>
            <SelectTrigger className="h-10 rounded-xl border-none bg-white">
              <SelectValue placeholder="户型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部户型</SelectItem>
              {floorPlans.map((plan) => (
                <SelectItem key={plan._id} value={String(plan._id)}>
                  {plan.name || '未命名户型'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deviceId} onValueChange={setDeviceId}>
            <SelectTrigger className="h-10 rounded-xl border-none bg-white">
              <SelectValue placeholder="设备" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部设备</SelectItem>
              {devices.map((device) => (
                <SelectItem key={device._id} value={device.code}>
                  {device.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="px-5 py-4">时间</TableHead>
                <TableHead className="px-5 py-4">操作人</TableHead>
                <TableHead className="px-5 py-4">企业</TableHead>
                <TableHead className="px-5 py-4">设备</TableHead>
                <TableHead className="px-5 py-4">户型</TableHead>
                <TableHead className="px-5 py-4">房间</TableHead>
                <TableHead className="px-5 py-4">类型</TableHead>
                <TableHead className="px-5 py-4">方向</TableHead>
                <TableHead className="px-5 py-4 text-right">数值</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow key={item._id} className="hover:bg-muted/10">
                  <TableCell className="px-5 py-4 text-sm text-muted-foreground">{formatTime(item.measuredAt)}</TableCell>
                  <TableCell className="px-5 py-4 font-medium">{getName(item.operatorId)}</TableCell>
                  <TableCell className="px-5 py-4 text-sm">{getName(item.enterpriseId)}</TableCell>
                  <TableCell className="px-5 py-4 font-mono text-xs">{item.deviceId || '-'}</TableCell>
                  <TableCell className="px-5 py-4 text-sm">{getName(item.floorPlanId)}</TableCell>
                  <TableCell className="px-5 py-4 text-sm">{item.roomName || item.roomId || '-'}</TableCell>
                  <TableCell className="px-5 py-4">
                    <Badge className="border-none bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                      {TYPE_LABELS[item.type] || item.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-5 py-4 text-sm text-muted-foreground">
                    {item.direction ? DIRECTION_LABELS[item.direction] || item.direction : '-'}
                  </TableCell>
                  <TableCell className="px-5 py-4 text-right font-mono font-semibold">{formatValue(item)}</TableCell>
                </TableRow>
              ))}
              {filteredItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="h-52 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Activity size={30} className="opacity-30" />
                      <p>{loading ? '正在加载量房记录...' : '暂无量房记录'}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

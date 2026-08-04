'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardList, RefreshCw, Ruler, Search, X } from 'lucide-react';
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
  if (item.type === 'angle') return `${value.toFixed(2)} ${item.unit || 'm'}`;
  return `${value.toFixed(2)} ${item.unit || 'meters'}`;
}

function formatDirection(value?: string) {
  if (!value) return '-';
  if (/^P\d+$/.test(value)) return `多边形墙 ${Number(value.slice(1)) + 1}`;
  return DIRECTION_LABELS[value] || value;
}

export default function MeasurementsPage() {
  const [items, setItems] = useState<MeasurementItem[]>([]);
  const [staff, setStaff] = useState<NamedOption[]>([]);
  const [floorPlans, setFloorPlans] = useState<NamedOption[]>([]);
  const [devices, setDevices] = useState<NamedOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [type, setType] = useState('all');
  const [operatorId, setOperatorId] = useState('all');
  const [floorPlanId, setFloorPlanId] = useState('all');
  const [deviceId, setDeviceId] = useState('all');
  const [search, setSearch] = useState('');
  const measurementRequestRef = useRef<AbortController | null>(null);

  const fetchFilters = useCallback(async () => {
    const [staffResult, planResult, deviceResult] = await Promise.allSettled([
      fetch('/api/staff').then((response) => response.json()),
      fetch('/api/floorplans').then((response) => response.json()),
      fetch('/api/devices').then((response) => response.json()),
    ]);

    if (staffResult.status === 'fulfilled' && staffResult.value.success) setStaff(staffResult.value.data || []);
    if (planResult.status === 'fulfilled' && planResult.value.success) setFloorPlans(planResult.value.data || []);
    if (deviceResult.status === 'fulfilled' && deviceResult.value.success) setDevices(deviceResult.value.data || []);
  }, []);

  const fetchMeasurements = useCallback(async () => {
    measurementRequestRef.current?.abort();
    const controller = new AbortController();
    measurementRequestRef.current = controller;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (type !== 'all') params.set('type', type);
      if (operatorId !== 'all') params.set('operatorId', operatorId);
      if (floorPlanId !== 'all') params.set('floorPlanId', floorPlanId);
      if (deviceId !== 'all') params.set('deviceId', deviceId);

      const response = await fetch(`/api/measurements?${params.toString()}`, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '量房记录加载失败');
      if (!controller.signal.aborted) setItems(result.data || []);
    } catch (error) {
      if (!controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : '量房记录加载失败');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [deviceId, floorPlanId, operatorId, type]);

  useEffect(() => {
    void fetchFilters();
  }, [fetchFilters]);

  useEffect(() => {
    void fetchMeasurements();
  }, [fetchMeasurements]);

  useEffect(() => () => measurementRequestRef.current?.abort(), []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return items;

    return items.filter((item) => [
      getName(item.operatorId),
      getName(item.enterpriseId),
      getName(item.floorPlanId),
      item.roomName,
      item.roomId,
      item.deviceId,
      item.type,
      item.direction,
      item.source,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(keyword));
  }, [items, search]);

  const hasActiveFilters = Boolean(search) || type !== 'all' || operatorId !== 'all' || floorPlanId !== 'all' || deviceId !== 'all';

  const clearFilters = () => {
    setSearch('');
    setType('all');
    setOperatorId('all');
    setFloorPlanId('all');
    setDeviceId('all');
  };

  return (
    <div className="admin-page-frame">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-foreground">
            <Ruler className="text-primary" size={20} />
            <h1 className="text-2xl font-semibold">量房记录</h1>
          </div>
          <p className="text-sm text-muted-foreground">查看正式户型的独立测量审计事件，支持按类型、人员、户型和设备筛选。</p>
        </div>
        <Button aria-label="刷新量房记录" disabled={loading} size="icon" title="刷新量房记录" variant="outline" onClick={() => void fetchMeasurements()}>
          <RefreshCw className={loading ? 'animate-spin' : ''} size={16} />
        </Button>
      </header>

      <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label="量房记录筛选与列表">
        <div className="grid gap-3 border-b border-border bg-muted/30 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(150px,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input aria-label="搜索量房记录" className="pl-9" placeholder="搜索人员、户型、房间或设备" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger aria-label="测量类型"><SelectValue placeholder="测量类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="length">边长</SelectItem>
              <SelectItem value="height">层高</SelectItem>
              <SelectItem value="angle">角度/斜边</SelectItem>
              <SelectItem value="opening_offset">门窗偏移</SelectItem>
              <SelectItem value="opening_width">门窗宽度</SelectItem>
            </SelectContent>
          </Select>
          <Select value={operatorId} onValueChange={setOperatorId}>
            <SelectTrigger aria-label="操作员工"><SelectValue placeholder="操作员工" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部员工</SelectItem>
              {staff.map((member) => <SelectItem key={member._id} value={String(member._id)}>{member.displayName || member.username}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={floorPlanId} onValueChange={setFloorPlanId}>
            <SelectTrigger aria-label="正式户型"><SelectValue placeholder="正式户型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部户型</SelectItem>
              {floorPlans.map((plan) => <SelectItem key={plan._id} value={String(plan._id)}>{plan.name || '未命名户型'}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={deviceId} onValueChange={setDeviceId}>
            <SelectTrigger aria-label="测距设备"><SelectValue placeholder="测距设备" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部设备</SelectItem>
              {devices.map((device) => <SelectItem key={device._id} value={device.code || device._id}>{device.code || device.name || device._id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="text-muted-foreground">最多显示符合条件的 100 条审计记录</span>
          <div className="flex items-center gap-2">
            {hasActiveFilters ? (
              <Button aria-label="清除量房记录筛选" size="icon" title="清除筛选" variant="ghost" onClick={clearFilters}>
                <X size={16} />
              </Button>
            ) : null}
            <Badge variant="secondary">{filteredItems.length} 条</Badge>
          </div>
        </div>

        {loadError ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 border-t border-border px-6 text-center">
            <AlertTriangle className="text-destructive" size={24} />
            <div>
              <p className="font-medium">无法加载量房记录</p>
              <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            </div>
            <Button variant="outline" onClick={() => void fetchMeasurements()}>重试</Button>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>企业</TableHead>
                  <TableHead>设备</TableHead>
                  <TableHead>户型 / 房间</TableHead>
                  <TableHead>测量类型</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">数值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item._id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatTime(item.measuredAt)}</TableCell>
                    <TableCell className="font-medium">{getName(item.operatorId)}</TableCell>
                    <TableCell>{getName(item.enterpriseId)}</TableCell>
                    <TableCell className="font-mono text-xs">{item.deviceId || '-'}</TableCell>
                    <TableCell>
                      <div className="min-w-36 font-medium">{getName(item.floorPlanId)}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{item.roomName || item.roomId || '未归属房间'}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{TYPE_LABELS[item.type] || item.type}</Badge></TableCell>
                    <TableCell><Badge variant={item.source === 'ble' ? 'secondary' : 'outline'}>{SOURCE_LABELS[item.source || ''] || item.source || '-'}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{formatDirection(item.direction)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatValue(item)}</TableCell>
                  </TableRow>
                ))}
                {!loading && filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-56 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ClipboardList size={28} />
                        <p>暂无符合条件的量房记录</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
                {loading && filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-56 text-center text-muted-foreground">正在加载量房记录...</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

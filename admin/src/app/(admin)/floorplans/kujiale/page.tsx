'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Copy,
  ExternalLink,
  ImageIcon,
  Loader2,
  MapPin,
  Search,
} from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Cascader, type CascaderOption } from '@/components/ui/cascader';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type KujialeCityGroup = {
  province: string;
  cities: Array<{ name: string; cityid: number }>;
};

type KujialeFloorPlanCard = {
  externalId: string;
  communityName: string;
  city?: string;
  area?: number;
  layoutLabel?: string;
  previewUrl?: string;
  sourceLabel?: string;
  rawSummary?: {
    name?: string;
    buildArea?: string;
    buildAreaFloat?: number;
    srcArea?: string;
    srcAreaFloat?: number;
    publicType?: string;
    imageUrl?: string;
    png?: string;
    wallCenterLine?: string;
    [key: string]: unknown;
  };
};

const DEFAULT_CITY_ID = '175';
const DEFAULT_CITY_NAME = '杭州';
const DEFAULT_PROVINCE_NAME = '浙江';

const SPEC_OPTIONS = [
  { value: '0', label: '不限户室' },
  { value: '1', label: '一居' },
  { value: '2', label: '二居' },
  { value: '3', label: '三居' },
  { value: '4', label: '四居' },
  { value: '5', label: '五居及以上' },
];

const AREA_OPTIONS = [
  { value: '0', label: '不限面积' },
  { value: '1', label: '60m²及以下' },
  { value: '2', label: '60-80m²' },
  { value: '3', label: '80-100m²' },
  { value: '4', label: '100-120m²' },
  { value: '5', label: '120-150m²' },
  { value: '6', label: '150-250m²' },
  { value: '7', label: '250-500m²' },
  { value: '8', label: '500m²及以上' },
];

function formatArea(plan: KujialeFloorPlanCard) {
  return plan.rawSummary?.buildArea || (plan.area ? `${plan.area}m²` : '-');
}

function buildPlanTitle(plan: KujialeFloorPlanCard) {
  return String(plan.rawSummary?.name || [plan.communityName, plan.layoutLabel].filter(Boolean).join(' ') || '未命名户型');
}

export default function KujialeFloorPlanSearchPage() {
  const [cities, setCities] = useState<KujialeCityGroup[]>([]);
  const [provinceName, setProvinceName] = useState(DEFAULT_PROVINCE_NAME);
  const [cityId, setCityId] = useState(DEFAULT_CITY_ID);
  const [communityName, setCommunityName] = useState('');
  const [specType, setSpecType] = useState('0');
  const [areaType, setAreaType] = useState('0');
  const [results, setResults] = useState<KujialeFloorPlanCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
  });

  const flatCities = useMemo(
    () => cities.flatMap((group) => group.cities.map((city) => ({ ...city, province: group.province }))),
    [cities],
  );

  const cascaderOptions = useMemo<CascaderOption[]>(() => {
    if (!cities.length) {
      return [
        {
          value: DEFAULT_PROVINCE_NAME,
          label: DEFAULT_PROVINCE_NAME,
          children: [{ value: DEFAULT_CITY_ID, label: DEFAULT_CITY_NAME }],
        },
      ];
    }

    return cities.map((group) => ({
      value: group.province,
      label: group.province,
      children: group.cities.map((city) => ({
        value: String(city.cityid),
        label: city.name,
      })),
    }));
  }, [cities]);

  const selectedCity = useMemo(
    () => flatCities.find((city) => String(city.cityid) === cityId),
    [flatCities, cityId],
  );

  const fetchCities = async () => {
    setCitiesLoading(true);
    try {
      const res = await fetch('/api/kujiale/cities');
      const data = await res.json();
      if (!data.success) {
        notify.fromAlert(data.error || '城市列表加载失败');
        return;
      }
      const cityData = data.data || [];
      setCities(cityData);

      const defaultProvince = cityData.find((group: KujialeCityGroup) => group.province === DEFAULT_PROVINCE_NAME) || cityData[0];
      const defaultCity = defaultProvince?.cities.find((city: { name: string; cityid: number }) => city.name === DEFAULT_CITY_NAME) || defaultProvince?.cities[0];
      if (defaultProvince && defaultCity) {
        setProvinceName(defaultProvince.province);
        setCityId(String(defaultCity.cityid));
      }
    } catch (error) {
      console.error('Failed to load KuJiale cities:', error);
      notify.fromAlert('城市列表加载失败');
    } finally {
      setCitiesLoading(false);
    }
  };

  const handleCityPathChange = (value: string[]) => {
    setProvinceName(value[0] || DEFAULT_PROVINCE_NAME);
    setCityId(value[1] || DEFAULT_CITY_ID);
  };

  const searchFloorPlans = async (page = 1) => {
    const keyword = communityName.trim();
    if (!keyword) {
      notify.warning('请先输入小区名称');
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({
        communityName: keyword,
        areaId: cityId,
        page: String(page),
        limit: String(pagination.limit),
      });
      if (selectedCity?.name || DEFAULT_CITY_NAME) params.set('city', selectedCity?.name || DEFAULT_CITY_NAME);
      if (specType !== '0') params.set('specType', specType);
      if (areaType !== '0') params.set('areaType', areaType);

      const res = await fetch(`/api/kujiale/floorplans/search?${params.toString()}`);
      const data = await res.json();

      if (!data.success) {
        notify.fromAlert(data.error || '酷家乐户型搜索失败');
        setResults([]);
        return;
      }

      setResults(data.data || []);
      setPagination(data.pagination || { ...pagination, page });
    } catch (error) {
      console.error('KuJiale search failed:', error);
      notify.fromAlert('酷家乐户型搜索失败');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPlanId = async (planId: string) => {
    try {
      await navigator.clipboard.writeText(planId);
      notify.success('planId 已复制');
    } catch (error) {
      console.error('Failed to copy planId:', error);
      notify.fromAlert('复制失败，请手动复制 planId');
    }
  };

  const handleOpenPreview = (url?: string) => {
    if (!url) {
      notify.warning('该户型暂无预览图');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    fetchCities();
  }, []);

  return (
    <div className="min-h-full bg-background text-foreground">
      <main className="mx-auto flex max-w-[1480px] flex-col gap-7 px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <Link
              href="/floorplans"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 text-muted-foreground')}
            >
              <ArrowLeft size={16} />
              返回本地户型图库
            </Link>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">酷家乐户型搜索</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                按城市和小区查询酷家乐已开放户型图，当前仅展示结果，不导入本地户型库。
              </p>
            </div>
          </div>
          <Badge variant="outline" className="w-fit px-3 py-1 text-muted-foreground">
            sandbox-openapi
          </Badge>
        </div>

        <section className="rounded-lg border bg-card p-4">
          <div className="grid gap-3 lg:grid-cols-[280px_1fr_170px_170px_auto]">
            <Cascader
              options={cascaderOptions}
              value={[provinceName, cityId]}
              onValueChange={handleCityPathChange}
              placeholder={citiesLoading ? '城市加载中' : '选择省份 / 城市'}
              disabled={citiesLoading}
            />

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                value={communityName}
                onChange={(event) => setCommunityName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') searchFloorPlans(1);
                }}
                placeholder="输入小区名称，如 左邻右舍"
                className="h-10 bg-background pl-10"
              />
            </div>

            <Select value={specType} onValueChange={setSpecType}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEC_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={areaType} onValueChange={setAreaType}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AREA_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={() => searchFloorPlans(1)}
              disabled={loading}
              className="h-10 px-5"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              搜索
            </Button>
          </div>
        </section>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <MapPin size={15} />
            当前城市：{selectedCity ? `${selectedCity.province} / ${selectedCity.name}` : `${provinceName} / ${DEFAULT_CITY_NAME}`}
          </div>
          {searched && !loading && (
            <div>
              共 {pagination.total} 个匹配户型
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 text-muted-foreground">
            <Loader2 className="mb-4 animate-spin" size={36} />
            <p className="text-sm font-medium">正在查询酷家乐户型图...</p>
          </div>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {results.map((plan) => (
            <article key={plan.externalId} className="overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40">
                <button
                  type="button"
                  onClick={() => handleOpenPreview(plan.previewUrl)}
                  className="relative flex aspect-[4/3] w-full items-center justify-center bg-muted/40"
                >
                  {plan.previewUrl ? (
                    <img
                      src={plan.previewUrl}
                      alt={buildPlanTitle(plan)}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="text-muted-foreground/40" size={42} />
                  )}
                  <span className="absolute right-3 top-3 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm">
                    {plan.sourceLabel || '酷家乐'}
                  </span>
                </button>

                <div className="flex flex-col gap-4 p-4">
                  <div>
                    <h2 className="line-clamp-2 text-base font-semibold">{buildPlanTitle(plan)}</h2>
                    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <Building2 size={14} />
                      <span className="truncate">{plan.communityName || '-'}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">建筑面积</p>
                      <p className="mt-1 font-semibold">{formatArea(plan)}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">套内面积</p>
                      <p className="mt-1 font-semibold">{plan.rawSummary?.srcArea || '-'}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">户室</p>
                      <p className="mt-1 font-semibold">{plan.layoutLabel || '-'}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">公开类型</p>
                      <p className="mt-1 font-semibold">{plan.rawSummary?.publicType || '-'}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t pt-4">
                    <div className="min-w-0 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">户型标识</span>
                      <span className="ml-2 break-all">{plan.externalId}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        title="复制 planId"
                        onClick={() => handleCopyPlanId(plan.externalId)}
                      >
                        <Copy size={15} />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        title="打开预览图"
                        onClick={() => handleOpenPreview(plan.previewUrl)}
                      >
                        <ExternalLink size={15} />
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-6 text-center">
            <div className="mb-4 rounded-full bg-muted p-4">
              <Search className="text-muted-foreground/50" size={32} />
            </div>
            <h2 className="text-lg font-semibold">{searched ? '未找到匹配户型' : '输入小区名称开始搜索'}</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {searched
                ? '可以更换城市、简化小区关键词，或放宽户室和面积筛选后重试。'
                : '默认使用杭州城市 ID，也可以先切换城市再查询酷家乐户型图。'}
            </p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <Pagination
            total={pagination.total}
            page={pagination.page}
            limit={pagination.limit}
            totalPages={pagination.totalPages}
            onChange={searchFloorPlans}
          />
        )}
      </main>
    </div>
  );
}

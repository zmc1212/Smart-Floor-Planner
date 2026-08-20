'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageContainer } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Cascader,
  Col,
  Empty,
  Flex,
  Input,
  Pagination,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  Building2,
  Copy,
  ExternalLink,
  ImageIcon,
  MapPin,
  Search,
} from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';

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

type CityCascaderOption = {
  value: string;
  label: string;
  children?: Array<{ value: string; label: string }>;
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
  const router = useRouter();
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

  const cascaderOptions = useMemo<CityCascaderOption[]>(() => {
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
    void fetchCities();
  }, []);

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="酷家乐户型搜索"
        content="按城市和小区查询酷家乐已开放户型图，当前仅展示结果，不导入本地户型库。"
        onBack={() => router.push('/floorplans')}
        extra={<Tag>sandbox-openapi</Tag>}
      >
        <Space direction="vertical" size={16} className="w-full">
          <Card className="admin-panel-card" size="small">
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} lg={6}>
                <Cascader
                  className="w-full"
                  options={cascaderOptions}
                  value={[provinceName, cityId]}
                  onChange={(value) => handleCityPathChange((value as string[]) || [])}
                  placeholder={citiesLoading ? '城市加载中' : '选择省份 / 城市'}
                  disabled={citiesLoading}
                  allowClear={false}
                  changeOnSelect={false}
                />
              </Col>
              <Col xs={24} lg={8}>
                <Input
                  allowClear
                  value={communityName}
                  onChange={(event) => setCommunityName(event.target.value)}
                  onPressEnter={() => void searchFloorPlans(1)}
                  placeholder="输入小区名称，如 左邻右舍"
                  prefix={<Search size={16} />}
                />
              </Col>
              <Col xs={24} sm={12} lg={4}>
                <Select
                  className="w-full"
                  value={specType}
                  onChange={setSpecType}
                  options={SPEC_OPTIONS}
                />
              </Col>
              <Col xs={24} sm={12} lg={4}>
                <Select
                  className="w-full"
                  value={areaType}
                  onChange={setAreaType}
                  options={AREA_OPTIONS}
                />
              </Col>
              <Col xs={24} lg={2}>
                <Button
                  type="primary"
                  block
                  loading={loading}
                  icon={<Search size={16} />}
                  onClick={() => void searchFloorPlans(1)}
                >
                  搜索
                </Button>
              </Col>
            </Row>
          </Card>

          <Flex justify="space-between" align="center" wrap gap={8}>
            <Typography.Text type="secondary">
              <Space size={6}>
                <MapPin size={15} />
                当前城市：{selectedCity ? `${selectedCity.province} / ${selectedCity.name}` : `${provinceName} / ${DEFAULT_CITY_NAME}`}
              </Space>
            </Typography.Text>
            {searched && !loading ? (
              <Typography.Text type="secondary">共 {pagination.total} 个匹配户型</Typography.Text>
            ) : null}
          </Flex>

          {loading ? (
            <Card className="admin-panel-card">
              <Flex vertical align="center" justify="center" className="min-h-[320px]">
                <Spin tip="正在查询酷家乐户型图..." />
              </Flex>
            </Card>
          ) : results.length > 0 ? (
            <>
              <Row gutter={[16, 16]}>
                {results.map((plan) => (
                  <Col key={plan.externalId} xs={24} md={12} xl={8}>
                    <Card
                      className="admin-panel-card h-full"
                      cover={(
                        <button
                          type="button"
                          onClick={() => handleOpenPreview(plan.previewUrl)}
                          className="relative flex aspect-[4/3] w-full items-center justify-center bg-[var(--ant-color-fill-alter)] border-0 cursor-pointer p-0"
                        >
                          {plan.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={plan.previewUrl}
                              alt={buildPlanTitle(plan)}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <ImageIcon className="text-[var(--ant-color-text-quaternary)]" size={42} />
                          )}
                          <Tag className="!absolute !right-3 !top-3 !m-0">
                            {plan.sourceLabel || '酷家乐'}
                          </Tag>
                        </button>
                      )}
                      actions={[
                        <Button
                          key="copy"
                          type="text"
                          icon={<Copy size={15} />}
                          aria-label="复制 planId"
                          onClick={() => void handleCopyPlanId(plan.externalId)}
                        >
                          复制标识
                        </Button>,
                        <Button
                          key="preview"
                          type="text"
                          icon={<ExternalLink size={15} />}
                          aria-label="打开预览图"
                          onClick={() => handleOpenPreview(plan.previewUrl)}
                        >
                          预览
                        </Button>,
                      ]}
                    >
                      <Space direction="vertical" size={12} className="w-full">
                        <div>
                          <Typography.Title level={5} className="!mb-1 !mt-0" ellipsis={{ rows: 2, tooltip: buildPlanTitle(plan) }}>
                            {buildPlanTitle(plan)}
                          </Typography.Title>
                          <Typography.Text type="secondary">
                            <Space size={6}>
                              <Building2 size={14} />
                              <span className="truncate">{plan.communityName || '-'}</span>
                            </Space>
                          </Typography.Text>
                        </div>

                        <Row gutter={[8, 8]}>
                          <Col span={12}>
                            <Card size="small" type="inner">
                              <Typography.Text type="secondary" className="text-xs">建筑面积</Typography.Text>
                              <div className="mt-1 font-semibold">{formatArea(plan)}</div>
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card size="small" type="inner">
                              <Typography.Text type="secondary" className="text-xs">套内面积</Typography.Text>
                              <div className="mt-1 font-semibold">{plan.rawSummary?.srcArea || '-'}</div>
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card size="small" type="inner">
                              <Typography.Text type="secondary" className="text-xs">户室</Typography.Text>
                              <div className="mt-1 font-semibold">{plan.layoutLabel || '-'}</div>
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card size="small" type="inner">
                              <Typography.Text type="secondary" className="text-xs">公开类型</Typography.Text>
                              <div className="mt-1 font-semibold">{plan.rawSummary?.publicType || '-'}</div>
                            </Card>
                          </Col>
                        </Row>

                        <Typography.Text type="secondary" className="text-xs break-all">
                          <Typography.Text strong>户型标识</Typography.Text>
                          <span className="ml-2">{plan.externalId}</span>
                        </Typography.Text>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>

              <Flex justify="center">
                <Pagination
                  current={pagination.page}
                  pageSize={pagination.limit}
                  total={pagination.total}
                  showSizeChanger={false}
                  onChange={(page) => void searchFloorPlans(page)}
                />
              </Flex>
            </>
          ) : (
            <Card className="admin-panel-card">
              <Empty
                className="min-h-[280px] flex flex-col justify-center"
                image={<Search className="text-[var(--ant-color-text-quaternary)]" size={32} />}
                description={(
                  <Space direction="vertical" size={4}>
                    <Typography.Text strong>
                      {searched ? '未找到匹配户型' : '输入小区名称开始搜索'}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {searched
                        ? '可以更换城市、简化小区关键词，或放宽户室和面积筛选后重试。'
                        : '默认使用杭州城市 ID，也可以先切换城市再查询酷家乐户型图。'}
                    </Typography.Text>
                  </Space>
                )}
              />
            </Card>
          )}
        </Space>
      </PageContainer>
    </div>
  );
}

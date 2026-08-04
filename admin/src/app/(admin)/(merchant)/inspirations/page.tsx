'use client';

import { useRef, useState } from 'react';
import { Eye, ImagePlus, Plus, Star, Trash2, Upload } from 'lucide-react';
import {
  ModalForm,
  PageContainer,
  ProForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { Button, Image, Popconfirm, Space, Tag, Typography, Upload as AntUpload } from 'antd';
import type { UploadProps } from 'antd';
import { notify } from '@/components/ui/operation-feedback';

type Inspiration = {
  _id: string;
  title: string;
  coverImage: string;
  renderingImage: string;
  style: string;
  roomType: string;
  isRecommended: boolean;
  viewCount: number;
  createdAt?: string;
};

type InspirationFormValues = {
  title: string;
  style: string;
  roomType: string;
  coverImage: string;
  renderingImage: string;
  isRecommended: boolean;
};

type ImageUploadFieldProps = {
  label: string;
  help: string;
  value?: string;
  onChange?: (value: string) => void;
};

const DEFAULT_LAYOUT_DATA = [{ id: 'room-1', name: '复刻空间', width: 400, height: 300, openings: [] }];

const ROOM_TYPE_OPTIONS = [
  { label: '客厅', value: '客厅' },
  { label: '主卧', value: '主卧' },
  { label: '厨房', value: '厨房' },
  { label: '卫生间', value: '卫生间' },
];

const STYLE_OPTIONS = [
  { label: '现代简约', value: '现代简约' },
  { label: '侘寂风', value: '侘寂风' },
  { label: '原木风', value: '原木风' },
  { label: '轻法式奶油', value: '轻法式奶油' },
  { label: '精致轻奢', value: '精致轻奢' },
];

function ImageUploadField({ label, help, value, onChange }: ImageUploadFieldProps) {
  const [uploading, setUploading] = useState(false);

  const beforeUpload: UploadProps['beforeUpload'] = async (file) => {
    if (file.size > 500 * 1024) {
      notify.error('图片体积不能超过 500KB，请压缩后再上传');
      return AntUpload.LIST_IGNORE;
    }

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      onChange?.(dataUrl);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '图片读取失败');
    } finally {
      setUploading(false);
    }

    return AntUpload.LIST_IGNORE;
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border border-dashed border-border bg-muted/30 p-4">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-card">
        {value ? <Image alt={label} className="object-cover" height={80} preview src={value} width={80} /> : <ImagePlus className="text-muted-foreground" size={24} />}
      </div>
      <Space direction="vertical" size={4}>
        <AntUpload accept="image/*" beforeUpload={beforeUpload} maxCount={1} showUploadList={false}>
          <Button icon={<Upload size={16} />} loading={uploading}>
            上传{label}
          </Button>
        </AntUpload>
        <Typography.Text type="secondary" className="text-xs">
          {help}
        </Typography.Text>
      </Space>
    </div>
  );
}

export default function InspirationsPage() {
  const actionRef = useRef<ActionType>(null);
  const [previewing, setPreviewing] = useState<Inspiration | null>(null);

  const deleteInspiration = async (inspiration: Inspiration) => {
    try {
      const response = await fetch(`/api/inspirations?id=${inspiration._id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除失败');
      await actionRef.current?.reload();
      notify.success('灵感方案已删除');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const columns: ProColumns<Inspiration>[] = [
    {
      title: '封面',
      dataIndex: 'coverImage',
      width: 92,
      hideInSearch: true,
      render: (_, inspiration) => (
        <Image
          alt={`${inspiration.title}封面`}
          className="rounded-md object-cover"
          height={48}
          preview
          src={inspiration.coverImage}
          width={64}
        />
      ),
    },
    {
      title: '方案名称',
      dataIndex: 'title',
      render: (_, inspiration) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{inspiration.title}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            渲染图与一键复刻布局素材
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '空间类型',
      dataIndex: 'roomType',
      width: 140,
      valueType: 'select',
      valueEnum: Object.fromEntries(ROOM_TYPE_OPTIONS.map((item) => [item.value, { text: item.label }])),
      render: (_, inspiration) => <Tag>{inspiration.roomType}</Tag>,
    },
    {
      title: '设计风格',
      dataIndex: 'style',
      width: 160,
      valueType: 'select',
      valueEnum: Object.fromEntries(STYLE_OPTIONS.map((item) => [item.value, { text: item.label }])),
      render: (_, inspiration) => <Tag color="green">{inspiration.style}</Tag>,
    },
    {
      title: '首页推荐',
      dataIndex: 'isRecommended',
      width: 130,
      valueType: 'select',
      valueEnum: {
        true: { text: '已推荐', status: 'Success' },
        false: { text: '未推荐', status: 'Default' },
      },
      render: (_, inspiration) => inspiration.isRecommended ? <Tag color="gold" icon={<Star size={13} fill="currentColor" />}>已推荐</Tag> : <Tag>未推荐</Tag>,
    },
    {
      title: '浏览量',
      dataIndex: 'viewCount',
      width: 100,
      hideInSearch: true,
      render: (value) => Number(value || 0).toLocaleString(),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      hideInSearch: true,
      render: (_, inspiration) => inspiration.createdAt ? new Date(inspiration.createdAt).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 160,
      render: (_, inspiration) => (
        <Space size={8}>
          <Button aria-label={`查看 ${inspiration.title}`} icon={<Eye size={14} />} size="small" onClick={() => setPreviewing(inspiration)}>详情</Button>
        <Popconfirm
          cancelText="取消"
          description="删除后无法恢复，且不再向小程序展示。"
          okButtonProps={{ danger: true }}
          okText="删除"
          placement="left"
          title="删除灵感方案？"
          onConfirm={() => deleteInspiration(inspiration)}
        >
          <Button aria-label={`删除 ${inspiration.title}`} danger icon={<Trash2 size={14} />} size="small">删除</Button>
        </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="AI 灵感方案"
        content="维护小程序展示和 AI 设计参考使用的空间案例、封面与渲染素材。"
        extra={[
          <ModalForm<InspirationFormValues>
            key="create"
            layout="vertical"
            modalProps={{ destroyOnClose: true }}
            title="发布灵感方案"
            trigger={<Button icon={<Plus size={16} />} type="primary">发布方案</Button>}
            initialValues={{ isRecommended: false, roomType: '客厅', style: '现代简约' }}
            onFinish={async (values) => {
              try {
                const response = await fetch('/api/inspirations', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...values, layoutData: DEFAULT_LAYOUT_DATA }),
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || '发布失败');
                await actionRef.current?.reload();
                notify.success('灵感方案已发布');
                return true;
              } catch (error) {
                notify.error(error instanceof Error ? error.message : '发布失败');
                return false;
              }
            }}
          >
            <ProFormText label="方案名称" name="title" placeholder="例如：极简原木风温馨客厅" rules={[{ required: true, message: '请输入方案名称' }]} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ProFormSelect label="空间类型" name="roomType" options={ROOM_TYPE_OPTIONS} rules={[{ required: true, message: '请选择空间类型' }]} />
              <ProFormSelect label="设计风格" name="style" options={STYLE_OPTIONS} rules={[{ required: true, message: '请选择设计风格' }]} />
            </div>
            <ProForm.Item label="展示封面" name="coverImage" rules={[{ required: true, message: '请上传展示封面' }]}>
              <ImageUploadField help="支持常见图片格式，文件不超过 500KB。" label="展示封面" />
            </ProForm.Item>
            <ProForm.Item label="渲染效果图" name="renderingImage" rules={[{ required: true, message: '请上传渲染效果图' }]}>
              <ImageUploadField help="作为 AI 设计参考素材，建议使用完整、清晰的空间图。" label="渲染效果图" />
            </ProForm.Item>
            <ProFormSwitch label="首页精选推荐" name="isRecommended" />
          </ModalForm>,
        ]}
      >
        <ProTable<Inspiration>
          actionRef={actionRef}
          columns={columns}
          pagination={{ defaultPageSize: 10, showSizeChanger: true }}
          rowKey="_id"
          scroll={{ x: 1080 }}
          options={{ density: true, reload: true, setting: true }}
          search={{ defaultCollapsed: false, labelWidth: 'auto' }}
          request={async (params) => {
            const searchParams = new URLSearchParams();
            if (params.roomType) searchParams.set('roomType', String(params.roomType));
            if (params.style) searchParams.set('style', String(params.style));

            const response = await fetch(`/api/inspirations?${searchParams.toString()}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '读取灵感方案失败');

            const keyword = String(params.title || '').trim().toLocaleLowerCase();
            const hasRecommendationFilter = params.isRecommended !== undefined && params.isRecommended !== '';
            const recommended = String(params.isRecommended) === 'true';
            const filtered = (result.data as Inspiration[]).filter((item) => {
              const matchesKeyword = !keyword || [item.title, item.style, item.roomType]
                .some((value) => value.toLocaleLowerCase().includes(keyword));
              const matchesRecommendation = !hasRecommendationFilter || item.isRecommended === recommended;
              return matchesKeyword && matchesRecommendation;
            });

            return { data: filtered, success: true, total: filtered.length };
          }}
        />
      </PageContainer>

      <Image
        alt={previewing?.title || '灵感方案预览'}
        preview={{
          open: Boolean(previewing),
          onOpenChange: (open) => !open && setPreviewing(null),
        }}
        src={previewing?.renderingImage || previewing?.coverImage}
        style={{ display: 'none' }}
      />
    </div>
  );
}

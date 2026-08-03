'use client';

import { useEffect, useState } from 'react';
import {
  ModalForm,
  ProFormDigit,
  ProFormText,
} from '@ant-design/pro-components';
import { Button, Flex, Form, Image, Row, Col, Typography, Upload } from 'antd';
import { Image as ImageIcon, Upload as UploadIcon } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import {
  DEFAULT_ENTERPRISE_FORM,
  EnterpriseFormState,
  EnterpriseListItem,
} from './types';

interface EnterpriseEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enterprise?: EnterpriseListItem | null;
  onSaved?: () => Promise<void> | void;
}

async function toBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

export default function EnterpriseEditorDialog({
  open,
  onOpenChange,
  enterprise,
  onSaved,
}: EnterpriseEditorDialogProps) {
  const [logo, setLogo] = useState(enterprise?.logo || '');

  useEffect(() => {
    if (open) setLogo(enterprise?.logo || '');
  }, [enterprise, open]);

  const initialValues: EnterpriseFormState = enterprise
    ? {
        name: enterprise.name || '',
        code: enterprise.code || '',
        contactPerson: {
          name: enterprise.contactPerson?.name || '',
          phone: enterprise.contactPerson?.phone || '',
          email: enterprise.contactPerson?.email || '',
        },
        logo: enterprise.logo || '',
        branding: {
          primaryColor: enterprise.branding?.primaryColor || '#171717',
          accentColor: enterprise.branding?.accentColor || '#0070f3',
        },
        groundPromotionFixedCommission: String(enterprise.groundPromotionFixedCommission ?? 0),
      }
    : DEFAULT_ENTERPRISE_FORM;

  const handleLogoChange = async (file: File) => {
    if (file.size > 1024 * 1024) {
      notify.error('图片大小不能超过 1MB');
      return;
    }

    try {
      setLogo(await toBase64(file));
    } catch (error) {
      console.error('Failed to convert image to base64:', error);
      notify.error('图片上传失败');
    }
  };

  const save = async (values: EnterpriseFormState) => {
    try {
      const url = enterprise ? `/api/admin/enterprises/${enterprise._id}` : '/api/admin/enterprises';
      const method = enterprise ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          logo,
          groundPromotionFixedCommission: String(values.groundPromotionFixedCommission ?? 0),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败');

      notify.success(enterprise ? '企业更新成功' : '企业创建成功');
      onOpenChange(false);
      await onSaved?.();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存失败');
      return false;
    }
  };

  return (
    <ModalForm<EnterpriseFormState>
      key={enterprise?._id || 'new'}
      title={enterprise ? '编辑企业基础信息' : '手动添加企业'}
      open={open}
      initialValues={initialValues}
      modalProps={{
        destroyOnHidden: true,
        maskClosable: false,
        onCancel: () => onOpenChange(false),
      }}
      onOpenChange={onOpenChange}
      onFinish={save}
      submitter={{
        searchConfig: { submitText: '保存企业', resetText: '取消' },
        render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex>,
      }}
    >
      <Typography.Paragraph type="secondary">
        这里仅维护基础资料、品牌信息与联系人；自动化配置请在独立页面维护。
      </Typography.Paragraph>

      <Row gutter={[20, 4]}>
        <Col span={24}>
          <ProFormText name="name" label="企业名称" rules={[{ required: true, message: '请输入企业名称' }]} fieldProps={{ placeholder: '例如：向总智能测绘科技有限公司' }} />
        </Col>
        <Col xs={24} md={12}>
          <ProFormText name="code" label="统一社会信用代码" rules={[{ required: true, message: '请输入统一社会信用代码' }]} fieldProps={{ placeholder: '18 位统一社会信用代码' }} />
        </Col>
        <Col xs={24} md={12}>
          <ProFormDigit name="groundPromotionFixedCommission" label="地推固定提成（元/单）" min={0} fieldProps={{ precision: 2, className: 'w-full' }} />
        </Col>
      </Row>

      <Form.Item label="企业 Logo" extra="支持 PNG、JPG。建议正方形 Logo，图片会以 Base64 存储，大小限制 1MB。">
        <Flex align="center" gap={16} wrap>
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {logo ? (
              <Image preview={false} src={logo} alt="企业 Logo 预览" className="h-full w-full object-contain" />
            ) : (
              <ImageIcon size={24} className="text-muted-foreground" />
            )}
          </div>
          <Flex gap={8}>
            <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => { void handleLogoChange(file); return false; }}>
              <Button icon={<UploadIcon size={16} />}>选择图片</Button>
            </Upload>
            {logo ? <Button danger type="text" onClick={() => setLogo('')}>移除</Button> : null}
          </Flex>
        </Flex>
      </Form.Item>

      <Row gutter={[20, 4]}>
        <Col xs={24} md={12}>
          <ProFormText name={['branding', 'primaryColor']} label="主色" fieldProps={{ placeholder: '#171717', prefix: <span className="h-4 w-4 rounded border bg-foreground" /> }} />
        </Col>
        <Col xs={24} md={12}>
          <ProFormText name={['branding', 'accentColor']} label="强调色" fieldProps={{ placeholder: '#0070f3', prefix: <span className="h-4 w-4 rounded border bg-primary" /> }} />
        </Col>
      </Row>

      <Row gutter={[20, 4]}>
        <Col xs={24} md={12}>
          <ProFormText name={['contactPerson', 'name']} label="联系人姓名" rules={[{ required: true, message: '请输入联系人姓名' }]} />
        </Col>
        <Col xs={24} md={12}>
          <ProFormText name={['contactPerson', 'phone']} label="联系电话" rules={[{ required: true, message: '请输入联系电话' }]} fieldProps={{ inputMode: 'tel' }} />
        </Col>
        <Col span={24}>
          <ProFormText name={['contactPerson', 'email']} label="联系邮箱（可选）" fieldProps={{ type: 'email' }} />
        </Col>
      </Row>
    </ModalForm>
  );
}

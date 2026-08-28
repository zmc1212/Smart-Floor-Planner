'use client';

import { useEffect, useState } from 'react';
import { Image, Typography, Upload, type UploadFile, type UploadProps } from 'antd';
import { ImagePlus } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';

export type ImageUploadResult = {
  previewUrl: string;
};

type ImageUploadFieldProps = {
  value?: string | null;
  onUpload: (file: File) => Promise<ImageUploadResult>;
  onChange?: (value: string | null) => void;
  onValueChange?: (value: string | null, result?: ImageUploadResult) => void;
  accept?: string;
  maxSizeBytes?: number;
  helpText?: string;
  uploadText?: string;
  previewAlt: string;
  ariaLabel?: string;
  uploadSuccessText?: string;
  uploadFailedText?: string;
  disabled?: boolean;
};

function fileListFromUrl(value: string | null | undefined): UploadFile[] {
  return value ? [{ uid: value, name: '已上传图片', status: 'done', url: value }] : [];
}

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes}MB` : `${megabytes.toFixed(1)}MB`;
}

export function ImageUploadField({
  value,
  onUpload,
  onChange,
  onValueChange,
  accept = 'image/jpeg,image/png,image/webp,image/gif',
  maxSizeBytes = 5 * 1024 * 1024,
  helpText,
  uploadText = '上传图片',
  previewAlt,
  ariaLabel,
  uploadSuccessText = '图片已上传',
  uploadFailedText = '图片上传失败，请稍后重试',
  disabled = false,
}: ImageUploadFieldProps) {
  const [fileList, setFileList] = useState<UploadFile[]>(() => fileListFromUrl(value));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    setFileList(fileListFromUrl(value));
  }, [value]);

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (!file.type.startsWith('image/')) {
      notify.error('请上传图片文件');
      return Upload.LIST_IGNORE;
    }
    if (file.size > maxSizeBytes) {
      notify.error(`图片不能超过 ${formatFileSize(maxSizeBytes)}`);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const customRequest: UploadProps['customRequest'] = async ({ file, onError, onProgress, onSuccess }) => {
    const imageFile = file as File & { uid?: string };
    setFileList([{ uid: imageFile.uid || imageFile.name, name: imageFile.name, status: 'uploading', percent: 0 }]);

    try {
      const result = await onUpload(imageFile);
      const nextFile = { uid: imageFile.uid || result.previewUrl, name: imageFile.name, status: 'done' as const, percent: 100, url: result.previewUrl };
      setFileList([nextFile]);
      onProgress?.({ percent: 100 });
      onSuccess?.(result);
      onChange?.(result.previewUrl);
      onValueChange?.(result.previewUrl, result);
      notify.success(uploadSuccessText);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(uploadFailedText));
      notify.error(error instanceof Error ? error.message : uploadFailedText);
      setFileList(fileListFromUrl(value));
    }
  };

  return (
    <>
      <Upload
        accept={accept}
        aria-label={ariaLabel || uploadText}
        beforeUpload={beforeUpload}
        customRequest={customRequest}
        disabled={disabled}
        fileList={fileList}
        listType="picture-card"
        maxCount={1}
        onPreview={(file) => {
          const nextPreviewUrl = file.url || file.thumbUrl;
          if (!nextPreviewUrl) return;
          setPreviewUrl(nextPreviewUrl);
          setPreviewOpen(true);
        }}
        onRemove={() => {
          setFileList([]);
          onChange?.(null);
          onValueChange?.(null);
          return true;
        }}
        showUploadList={{ showPreviewIcon: true, showRemoveIcon: !disabled }}
      >
        {fileList.length === 0 ? (
          <span className="flex h-24 w-24 flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImagePlus size={20} />
            <span className="text-xs">{uploadText}</span>
          </span>
        ) : null}
      </Upload>
      {helpText ? <Typography.Text type="secondary" className="block text-xs">{helpText}</Typography.Text> : null}
      {previewUrl ? (
        <Image
          alt={previewAlt}
          preview={{ visible: previewOpen, src: previewUrl, onVisibleChange: setPreviewOpen }}
          src={previewUrl}
          style={{ display: 'none' }}
        />
      ) : null}
    </>
  );
}

/* eslint-disable @next/next/no-img-element -- Cropping preview uses dynamic blob/data URLs. */
'use client';

import React, { useState, useRef } from 'react';
import ReactCrop, { type Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Button, Modal } from 'antd';

interface ImageCropperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onCropComplete: (croppedDataUrl: string) => void;
}

export default function ImageCropperDialog({ open, onOpenChange, imageUrl, onCropComplete }: ImageCropperDialogProps) {
  const [crop, setCrop] = useState<Crop>({
    unit: '%',
    width: 50,
    height: 50,
    x: 25,
    y: 25,
  });
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleGeneratePreview = () => {
    if (!imageRef.current || !crop.width || !crop.height) {
      return;
    }

    const image = imageRef.current;
    let pixelCrop = crop;

    if (crop.unit === '%') {
      pixelCrop = {
        unit: 'px',
        x: (crop.x / 100) * image.width,
        y: (crop.y / 100) * image.height,
        width: (crop.width / 100) * image.width,
        height: (crop.height / 100) * image.height,
      };
    }

    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    canvas.width = Math.max(1, pixelCrop.width * scaleX);
    canvas.height = Math.max(1, pixelCrop.height * scaleY);
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.drawImage(
        image,
        pixelCrop.x * scaleX,
        pixelCrop.y * scaleY,
        pixelCrop.width * scaleX,
        pixelCrop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const base64Image = canvas.toDataURL('image/jpeg', 0.9);
      setPreviewImageUrl(base64Image);
    }
  };

  const handleFinalConfirm = () => {
    if (previewImageUrl) {
      onCropComplete(previewImageUrl);
      onOpenChange(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      afterOpenChange={(visible) => {
        if (visible) setPreviewImageUrl(null);
      }}
      width={768}
      title={previewImageUrl ? '预览提取的风格图' : '框选心仪的风格'}
      footer={
        previewImageUrl ? (
          <>
            <Button onClick={() => setPreviewImageUrl(null)}>重新框选</Button>
            <Button type="primary" onClick={handleFinalConfirm}>确认并生成基准图</Button>
          </>
        ) : (
          <>
            <Button onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="primary" onClick={handleGeneratePreview}>预览提取结果</Button>
          </>
        )
      }
    >
      <p className="text-sm text-muted-foreground">
        {previewImageUrl
          ? '请确认提取的高清局部大图是否清晰、完整。如果满意，点击确认即可根据此图生成基准效果图。'
          : '从多风格拼图中框选出您最满意的一个角落，我们将以此作为下一步的风格参考。'
        }
      </p>

      <div className="mt-4 flex justify-center items-center bg-zinc-50 rounded-xl p-4 overflow-auto max-h-[65vh]">
        {previewImageUrl ? (
          <img
            src={previewImageUrl}
            alt="预览选区"
            style={{ maxHeight: '55vh', maxWidth: '100%', width: 'auto', height: 'auto', display: 'block', margin: '0 auto' }}
            className="rounded-lg shadow-sm border border-zinc-200"
          />
        ) : (
          <ReactCrop crop={crop} onChange={(c) => setCrop(c)}>
            <img
              ref={imageRef}
              src={imageUrl}
              alt="裁剪选区"
              style={{ maxHeight: '55vh', maxWidth: '100%', width: 'auto', height: 'auto', display: 'block', margin: '0 auto' }}
              crossOrigin="anonymous"
            />
          </ReactCrop>
        )}
      </div>
    </Modal>
  );
}

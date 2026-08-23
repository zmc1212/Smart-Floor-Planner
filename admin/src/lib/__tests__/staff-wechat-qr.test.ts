import assert from 'node:assert/strict';
import test from 'node:test';
import QRCode from 'qrcode';
import sharp from 'sharp';
import {
  prepareStaffWechatQrUpload,
  StaffWechatQrError,
  validateStaffWechatId,
} from '@/lib/staff-wechat-qr';

async function pngWithPayload(payload: string, size = 256) {
  const buffer = await QRCode.toBuffer(payload, {
    type: 'png',
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  return Buffer.from(buffer);
}

test('validateStaffWechatId rejects nicknames and blanks', () => {
  assert.equal(validateStaffWechatId('wx_designer_01'), 'wx_designer_01');
  assert.throws(() => validateStaffWechatId('  '), (error: unknown) => error instanceof StaffWechatQrError);
  assert.throws(() => validateStaffWechatId('设计师小王'), (error: unknown) => {
    return error instanceof StaffWechatQrError && error.code === 'invalid_wechat_id';
  });
  assert.throws(() => validateStaffWechatId('wx id'), (error: unknown) => error instanceof StaffWechatQrError);
});

test('prepareStaffWechatQrUpload rejects WebP and empty images', async () => {
  await assert.rejects(
    () => prepareStaffWechatQrUpload({ buffer: Buffer.from([1, 2, 3]), mimeType: 'image/webp' }),
    (error: unknown) => error instanceof StaffWechatQrError && error.code === 'unsupported_image_type'
  );
  await assert.rejects(
    () => prepareStaffWechatQrUpload({ buffer: Buffer.alloc(0), mimeType: 'image/png' }),
    (error: unknown) => error instanceof StaffWechatQrError && error.code === 'empty_image'
  );
});

test('prepareStaffWechatQrUpload stores PNG without decoding the QR payload', async () => {
  const png = await pngWithPayload('https://u.weixin.qq.com/s/test-designer-friend');
  const prepared = await prepareStaffWechatQrUpload({ buffer: png, mimeType: 'image/jpeg' });
  assert.equal(prepared.mimeType, 'image/png');
  assert.ok(prepared.buffer.length > 0);
  assert.ok(prepared.width >= 80);
  assert.ok(prepared.height >= 80);
  assert.deepEqual([...prepared.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('prepareStaffWechatQrUpload sniffs JPEG when Mini Program MIME is empty', async () => {
  const png = await pngWithPayload('https://u.weixin.qq.com/s/test-designer-friend');
  const jpeg = await sharp(png).jpeg({ quality: 90 }).toBuffer();
  const prepared = await prepareStaffWechatQrUpload({ buffer: jpeg, mimeType: '' });
  assert.equal(prepared.mimeType, 'image/png');
  assert.ok(prepared.width >= 80);
});

test('prepareStaffWechatQrUpload accepts a 二维码名片 screenshot that jsQR cannot decode', async () => {
  const card = await sharp({
    create: {
      width: 720,
      height: 960,
      channels: 3,
      background: { r: 248, g: 250, b: 249 },
    },
  })
    .png()
    .toBuffer();
  const prepared = await prepareStaffWechatQrUpload({
    buffer: card,
    mimeType: 'application/octet-stream',
  });
  assert.equal(prepared.mimeType, 'image/png');
  assert.equal(prepared.width, 720);
  assert.equal(prepared.height, 960);
});

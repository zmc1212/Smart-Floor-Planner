import assert from 'node:assert/strict';
import test from 'node:test';
import QRCode from 'qrcode';
import sharp from 'sharp';
import {
  isPersonalWechatFriendPayload,
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

test('isPersonalWechatFriendPayload accepts personal friend links and rejects pay/group', () => {
  assert.equal(isPersonalWechatFriendPayload('https://u.weixin.qq.com/s/abcdef'), true);
  assert.equal(isPersonalWechatFriendPayload('https://weixin.qq.com/r/xxx'), true);
  assert.equal(isPersonalWechatFriendPayload('weixin://contacts/profile/wxid_abc'), true);
  assert.equal(isPersonalWechatFriendPayload('wxp://f2f0xxxx'), false);
  assert.equal(isPersonalWechatFriendPayload('https://c.weixin.qq.com/g/xxxx'), false);
  assert.equal(isPersonalWechatFriendPayload('https://mp.weixin.qq.com/s/xxx'), false);
  assert.equal(isPersonalWechatFriendPayload(''), false);
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

test('prepareStaffWechatQrUpload accepts a personal WeChat QR and stores PNG', async () => {
  const png = await pngWithPayload('https://u.weixin.qq.com/s/test-designer-friend');
  const prepared = await prepareStaffWechatQrUpload({ buffer: png, mimeType: 'image/jpeg' });
  assert.equal(prepared.mimeType, 'image/png');
  assert.ok(prepared.buffer.length > 0);
  assert.equal(prepared.payload.startsWith('https://u.weixin.qq.com/'), true);
  assert.deepEqual([...prepared.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('prepareStaffWechatQrUpload rejects a payment QR payload', async () => {
  const png = await pngWithPayload('wxp://f2f0payment-test');
  await assert.rejects(
    () => prepareStaffWechatQrUpload({ buffer: png, mimeType: 'image/png' }),
    (error: unknown) => error instanceof StaffWechatQrError && error.code === 'qr_not_personal'
  );
});

test('prepareStaffWechatQrUpload rejects blank white PNG without a code', async () => {
  const blank = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    () => prepareStaffWechatQrUpload({ buffer: blank, mimeType: 'image/png' }),
    (error: unknown) => error instanceof StaffWechatQrError && error.code === 'qr_not_found'
  );
});

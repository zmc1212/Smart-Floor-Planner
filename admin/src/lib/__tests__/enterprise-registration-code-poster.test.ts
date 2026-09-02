import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  composeEnterpriseRegistrationCodePoster,
  resolveQrOverlayRect,
} from '@/lib/enterprise-registration-code-poster';
import {
  DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG,
  getEnterpriseRegistrationTemplateBackgroundPath,
  normalizeEnterpriseRegistrationCodeTemplateConfig,
} from '@/lib/platform-enterprise-registration-code-template-config';

test('normalizeEnterpriseRegistrationCodeTemplateConfig clamps placement ratios', () => {
  const config = normalizeEnterpriseRegistrationCodeTemplateConfig({
    templateId: 'merchant-onboarding-v1',
    qrPlacement: {
      centerX: 1.4,
      centerY: -0.2,
      diameter: 0.9,
      shape: 'square',
    },
  });
  assert.equal(config.templateId, 'merchant-onboarding-v1');
  assert.equal(config.qrPlacement.centerX, 1);
  assert.equal(config.qrPlacement.centerY, 0);
  assert.equal(config.qrPlacement.diameter, 0.9);
  assert.equal(config.qrPlacement.shape, 'square');
});

test('resolveQrOverlayRect converts normalized placement to pixel coordinates', () => {
  const rect = resolveQrOverlayRect(1000, 2000, {
    centerX: 0.5,
    centerY: 0.25,
    diameter: 0.2,
    shape: 'circle',
  });
  assert.equal(rect.diameter, 200);
  assert.equal(rect.left, 400);
  assert.equal(rect.top, 400);
});

test('composeEnterpriseRegistrationCodePoster overlays QR onto the built-in template', async () => {
  const backgroundPath = getEnterpriseRegistrationTemplateBackgroundPath(
    DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG.templateId
  );
  const qr = await sharp({
    create: {
      width: 280,
      height: 280,
      channels: 3,
      background: '#111111',
    },
  })
    .png()
    .toBuffer();

  const poster = await composeEnterpriseRegistrationCodePoster({
    qrImage: qr,
    backgroundPath,
    placement: DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG.qrPlacement,
  });

  assert.ok(poster.length > 0);
  const metadata = await sharp(poster).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.ok((metadata.width || 0) > 0);
  assert.ok((metadata.height || 0) > 0);
  assert.ok(poster.length < 500 * 1024);
});

test('composeEnterpriseRegistrationCodePoster rejects missing template backgrounds', async () => {
  const qr = await readFile(
    path.join(process.cwd(), 'assets', 'enterprise-registration-templates', 'merchant-onboarding-v1.jpg')
  ).catch(async () =>
    sharp({
      create: {
        width: 120,
        height: 120,
        channels: 3,
        background: '#111111',
      },
    })
      .png()
      .toBuffer()
  );

  await assert.rejects(
    () =>
      composeEnterpriseRegistrationCodePoster({
        qrImage: Buffer.from(qr),
        backgroundPath: path.join(process.cwd(), 'assets', 'missing-template.jpg'),
        placement: DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG.qrPlacement,
      }),
    /ENOENT|Invalid poster background dimensions/
  );
});

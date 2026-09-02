import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import {
  loadActiveEnterpriseRegistrationCodeImage,
} from '@/lib/enterprise-registration-code-image';
import {
  getEnterpriseRegistrationTemplateBackgroundPath,
  getPlatformEnterpriseRegistrationCodeTemplateConfig,
  type EnterpriseRegistrationQrPlacement,
} from '@/lib/platform-enterprise-registration-code-template-config';

export type ActiveRegistrationCodePoster =
  | {
      ok: true;
      image: Uint8Array;
      contentType: 'image/jpeg';
      extension: 'jpg';
    }
  | { ok: false; kind: 'active_code_not_found' }
  | { ok: false; kind: 'wechat_code_unavailable'; error: unknown }
  | { ok: false; kind: 'template_background_missing' }
  | { ok: false; kind: 'poster_composition_failed'; error: unknown };

export function resolveQrOverlayRect(
  backgroundWidth: number,
  backgroundHeight: number,
  placement: EnterpriseRegistrationQrPlacement
) {
  const diameter = Math.max(
    1,
    Math.round(backgroundWidth * clampPlacementRatio(placement.diameter, 0.24))
  );
  const centerX = Math.round(backgroundWidth * clampPlacementRatio(placement.centerX, 0.5));
  const centerY = Math.round(backgroundHeight * clampPlacementRatio(placement.centerY, 0.36));
  const left = Math.max(0, centerX - Math.round(diameter / 2));
  const top = Math.max(0, centerY - Math.round(diameter / 2));
  return { left, top, diameter };
}

function clampPlacementRatio(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

async function buildCircularQrOverlay(qrBuffer: Buffer, diameter: number) {
  const resized = await sharp(qrBuffer)
    .resize(diameter, diameter, { fit: 'cover' })
    .png()
    .toBuffer();
  const mask = await sharp({
    create: {
      width: diameter,
      height: diameter,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="white"/></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  return sharp(resized).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function buildSquareQrOverlay(qrBuffer: Buffer, diameter: number) {
  return sharp(qrBuffer).resize(diameter, diameter, { fit: 'cover' }).png().toBuffer();
}

export async function composeEnterpriseRegistrationCodePoster(input: {
  qrImage: Buffer;
  backgroundPath: string;
  placement: EnterpriseRegistrationQrPlacement;
}) {
  const background = await readFile(input.backgroundPath);
  const metadata = await sharp(background).metadata();
  const backgroundWidth = Number(metadata.width) || 0;
  const backgroundHeight = Number(metadata.height) || 0;
  if (!backgroundWidth || !backgroundHeight) {
    throw new Error('Invalid poster background dimensions');
  }

  const { left, top, diameter } = resolveQrOverlayRect(
    backgroundWidth,
    backgroundHeight,
    input.placement
  );
  const qrOverlay =
    input.placement.shape === 'square'
      ? await buildSquareQrOverlay(input.qrImage, diameter)
      : await buildCircularQrOverlay(input.qrImage, diameter);

  return sharp(background)
    .composite([{ input: qrOverlay, left, top }])
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

export async function loadActiveEnterpriseRegistrationCodePoster(input: {
  actorStaffId: bigint;
}): Promise<ActiveRegistrationCodePoster> {
  const [qrResult, templateConfig] = await Promise.all([
    loadActiveEnterpriseRegistrationCodeImage({ actorStaffId: input.actorStaffId }),
    getPlatformEnterpriseRegistrationCodeTemplateConfig(),
  ]);

  if (!qrResult.ok) {
    return qrResult;
  }

  const backgroundPath = getEnterpriseRegistrationTemplateBackgroundPath(
    templateConfig.templateId
  );
  try {
    const poster = await composeEnterpriseRegistrationCodePoster({
      qrImage: Buffer.from(qrResult.image),
      backgroundPath,
      placement: templateConfig.qrPlacement,
    });
    return {
      ok: true,
      image: new Uint8Array(poster),
      contentType: 'image/jpeg',
      extension: 'jpg',
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: false, kind: 'template_background_missing' };
    }
    return { ok: false, kind: 'poster_composition_failed', error };
  }
}

export function enterpriseRegistrationCodePosterResponse(
  result: Extract<ActiveRegistrationCodePoster, { ok: true }>
) {
  return new NextResponse(new Uint8Array(result.image), {
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `inline; filename="enterprise-registration-poster.${result.extension}"`,
    },
  });
}

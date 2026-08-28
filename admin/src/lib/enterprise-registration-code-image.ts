import { NextResponse } from 'next/server';
import { EnterpriseRegistrationCodeRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getPlatformMiniProgramCodeConfig } from '@/lib/platform-mini-program-code-config';
import {
  createEnterpriseRegistrationCode,
  getMiniProgramCodeContentType,
} from '@/lib/wechat-miniprogram-code';

export type ActiveRegistrationCodeImage =
  | {
      ok: true;
      image: Buffer;
      contentType: string;
      extension: string;
    }
  | { ok: false; kind: 'active_code_not_found' }
  | { ok: false; kind: 'wechat_code_unavailable'; error: unknown };

export async function loadActiveEnterpriseRegistrationCodeImage(input: {
  actorStaffId: bigint;
}): Promise<ActiveRegistrationCodeImage> {
  const revealed = await withPlatformTransaction((transaction) =>
    new EnterpriseRegistrationCodeRepository(transaction).revealActive({
      actorStaffId: input.actorStaffId,
    })
  );
  if (!revealed) {
    return { ok: false, kind: 'active_code_not_found' };
  }

  try {
    const { environment } = await getPlatformMiniProgramCodeConfig();
    const image = await createEnterpriseRegistrationCode(revealed.token, {
      envVersion: environment,
    });
    const contentType =
      getMiniProgramCodeContentType(image) ?? 'application/octet-stream';
    return {
      ok: true,
      image,
      contentType,
      extension: contentType === 'image/jpeg' ? 'jpg' : 'png',
    };
  } catch (error) {
    return { ok: false, kind: 'wechat_code_unavailable', error };
  }
}

export function enterpriseRegistrationCodeImageResponse(
  result: Extract<ActiveRegistrationCodeImage, { ok: true }>
) {
  return new NextResponse(result.image, {
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `inline; filename="enterprise-registration-code.${result.extension}"`,
    },
  });
}

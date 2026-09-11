import { sharedReport, reportAsset } from '@/lib/design-reports/service';
import { reportFailure, privateHeaders } from '@/lib/design-reports/http';
import { reportAssetIds } from '@/lib/design-reports/contract';
import { renderReport } from '@/lib/design-reports/render';
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const row = await sharedReport(token);
    const assetId = new URL(request.url).searchParams.get('assetId');
    if (assetId) {
      const { asset, buffer } = await reportAsset(row.enterpriseId.toString(), row.publishedDraft!, assetId);
      return new Response(new Uint8Array(buffer), { headers: { ...privateHeaders, 'Content-Type': asset.mimeType } });
    }
    const urls = Object.fromEntries(reportAssetIds(row.publishedDraft!).map((id) => [id, `/api/public/design-reports/${token}?assetId=${id}`]));
    return new Response(renderReport(row.publishedDraft!, urls), { headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
  } catch (error) { return reportFailure(error); }
}

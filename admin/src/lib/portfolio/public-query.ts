import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows, type Row } from '@/db/repositories/assistant-repository';
import {
  buildProfessionalProfile,
  publicProfessionalProfile,
  type PublicProfessionalProfile,
} from '@/lib/professional-profile';
import { designerProfile, planComparison, workContent, type DesignerProfile, type WorkContent, type WorkImage, type WorkPlanComparison } from './contracts';

export type PublicWork = {
  id: string; versionId: string; authorId: string; authorName: string; title: string; description: string;
  primaryStyle: string; secondaryStyles: string[]; layoutTypes: string[]; authorRole: string;
  cityCode: string; cityName: string; district: string; community: { id: string; name: string } | null;
  area: number | null; rooms: string; coverAssetId: string; images: WorkImage[];
  highlights: string[]; materials: string[]; palette: Array<{ name: string; hex: string }>;
  tours: Array<{ url: string; provider: string; title: string }>;
  planComparison?: WorkPlanComparison;
};
export type Candidate = {
  work: PublicWork; content: WorkContent; profile: DesignerProfile;
  professional: PublicProfessionalProfile | null; portraitAvailable: boolean; enterpriseName: string;
};
export type CandidateQuery = { workId?: string; authorId?: string; city?: string; style?: string; layout?: string; recommend?: boolean };

const professionalColumns = sql`e.professional_designer_title,e.professional_measurer_title,e.professional_default_experience_years,
  e.professional_service_threshold,e.professional_force_enterprise_profile,e.professional_title_visibility_policy,
  a.professional_title,a.professional_career_start_year,a.professional_title_visible,
  a.professional_title_admin_override,a.professional_profile_locked,a.professional_show_actual_service_count`;

/** Shaped from the enterprise/author policy columns so callers can reuse the
 * shared professional-title rules without loading unrelated staff records. */
export function publicProfessionalForRow(row: Row): PublicProfessionalProfile | null {
  const enterprise = {
    professionalDesignerTitle: String(row.professional_designer_title ?? ''),
    professionalMeasurerTitle: String(row.professional_measurer_title ?? ''),
    professionalDefaultExperienceYears: Number(row.professional_default_experience_years ?? 7),
    professionalServiceThreshold: Number(row.professional_service_threshold ?? 100),
    professionalForceEnterpriseProfile: Boolean(row.professional_force_enterprise_profile),
    professionalTitleVisibilityPolicy: String(row.professional_title_visibility_policy ?? 'follow_staff'),
  };
  const staff = {
    role: 'designer',
    professionalTitle: String(row.professional_title ?? ''),
    professionalCareerStartYear: row.professional_career_start_year == null ? null : Number(row.professional_career_start_year),
    professionalTitleVisible: Boolean(row.professional_title_visible),
    professionalTitleAdminOverride: String(row.professional_title_admin_override ?? ''),
    professionalProfileLocked: Boolean(row.professional_profile_locked),
    professionalShowActualServiceCount: Boolean(row.professional_show_actual_service_count),
  };
  return publicProfessionalProfile(buildProfessionalProfile({ enterprise, staff, actualServiceCount: 0, displayRole: 'designer' }));
}

/** Public portfolio reads recheck publication, author status, tenant scope and
 * the current rights window. No permission evidence or private fields leave this query. */
export async function portfolioCandidates(tx: PostgresTransaction, enterpriseId: string, input: CandidateQuery = {}): Promise<Candidate[]> {
  const candidates = await rows(tx, sql`select w.id,w.author_id,w.published_version_id,v.content,a.display_name,e.name as enterprise_name,
    ${professionalColumns},p.content-'contact' as profile,c.id as community_id,c.name as community_name,
    (pt.id is not null) as portrait_available
    from app.portfolio_works w
    join app.enterprises e on e.id=w.enterprise_id
    join app.portfolio_versions v on v.enterprise_id=w.enterprise_id and v.work_id=w.id and v.id=w.published_version_id and v.status='published'
    join app.admin_users a on a.enterprise_id=w.enterprise_id and a.id=w.author_id and a.role='designer' and a.status='active' and a.must_change_password=false
    left join app.portfolio_profiles p on p.enterprise_id=w.enterprise_id and p.author_id=w.author_id
    left join app.portfolio_communities c on c.enterprise_id=w.enterprise_id and c.id::text=v.content->>'communityId'
    left join app.portfolio_portraits pt on pt.enterprise_id=w.enterprise_id and pt.author_id=w.author_id
    where w.enterprise_id=${enterpriseId} and w.kind='designer_work' and not w.withdrawn and v.content->>'showOnProfile'='true'
    ${input.recommend ? sql`and v.content->>'recommendable'='true'` : sql``}
    ${input.workId ? sql`and w.id=${input.workId}` : sql``} ${input.authorId ? sql`and w.author_id=${input.authorId}` : sql``}
    ${input.city ? sql`and v.content->>'cityCode'=${input.city}` : sql``}
    ${input.style ? sql`and (v.content->>'primaryStyle'=${input.style} or (v.content->'secondaryStyles') ? ${input.style})` : sql``}
    ${input.layout ? sql`and (v.content->'layoutTypes') ? ${input.layout}` : sql``}
    order by w.id desc limit 500 for share of w,v,a`);
  const result: Candidate[] = [];
  for (const row of candidates) {
    let content: WorkContent;
    try { content = workContent(row.content, true); } catch { continue; }
    if (content.rightsUntil && Date.parse(content.rightsUntil) <= Date.now()) continue;
    const profile = designerProfile(row.profile || { bio: '', cities: [], styles: [], featuredWorkIds: [] });
    result.push({
      content, profile, professional: publicProfessionalForRow(row), portraitAvailable: Boolean(row.portrait_available),
      enterpriseName: String(row.enterprise_name || ''),
      work: {
        id: String(row.id), versionId: String(row.published_version_id), authorId: String(row.author_id), authorName: String(row.display_name || '设计师'),
        title: content.title, description: content.description, primaryStyle: content.primaryStyle, secondaryStyles: content.secondaryStyles,
        layoutTypes: content.layoutTypes, authorRole: content.authorRole, cityCode: content.cityCode, cityName: content.cityName, district: content.district,
        area: content.area, rooms: content.rooms, community: row.community_id ? { id: String(row.community_id), name: String(row.community_name) } : null,
        images: content.images, coverAssetId: content.coverAssetId!, highlights: content.highlights, materials: content.materials,
        palette: content.palette, tours: content.tours, planComparison: planComparison(content.planComparison),
      },
    });
  }
  return result;
}

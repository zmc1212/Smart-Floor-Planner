import { and, countDistinct, eq, sql } from 'drizzle-orm';
import {
  adminUsers,
  aiGenerationPublications,
  enterprises,
  floorPlans,
  leadFloorPlans,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import {
  buildProfessionalProfile,
  type ProfessionalProfileDetails,
} from '@/lib/professional-profile';

export class ProfessionalProfileRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async countServedCustomers(input: {
    enterpriseId: bigint;
    staffId: bigint;
    role: string;
  }) {
    if (input.role === 'designer') {
      const rows = await this.transaction
        .select({ value: countDistinct(aiGenerationPublications.leadId) })
        .from(aiGenerationPublications)
        .where(and(
          eq(aiGenerationPublications.enterpriseId, input.enterpriseId),
          eq(aiGenerationPublications.creditedDesignerId, input.staffId)
        ));
      return Number(rows[0]?.value ?? 0);
    }
    if (input.role === 'measurer') {
      const rows = await this.transaction
        .select({ value: countDistinct(leadFloorPlans.leadId) })
        .from(floorPlans)
        .innerJoin(leadFloorPlans, eq(leadFloorPlans.floorPlanId, floorPlans.id))
        .where(and(
          eq(floorPlans.enterpriseId, input.enterpriseId),
          eq(floorPlans.staffId, input.staffId),
          eq(floorPlans.status, 'completed'),
          sql`${floorPlans.layoutData} ->> 'version' = '4'`,
          sql`${floorPlans.layoutData} ->> 'measurementMode' = 'surveying'`,
          sql`${floorPlans.layoutData} #>> '{surveyGraph,kind}' = 'survey-wall-graph'`
        ));
      return Number(rows[0]?.value ?? 0);
    }
    return 0;
  }

  async findForStaff(staffId: bigint): Promise<ProfessionalProfileDetails | null> {
    const rows = await this.transaction
      .select({ staff: adminUsers, enterprise: enterprises })
      .from(adminUsers)
      .innerJoin(enterprises, eq(adminUsers.enterpriseId, enterprises.id))
      .where(eq(adminUsers.id, staffId))
      .limit(1);
    const row = rows[0];
    if (!row || !row.staff.enterpriseId) return null;
    const actualServiceCount = await this.countServedCustomers({
      enterpriseId: row.staff.enterpriseId,
      staffId: row.staff.id,
      role: row.staff.role,
    });
    return buildProfessionalProfile({
      enterprise: row.enterprise,
      staff: row.staff,
      actualServiceCount,
    });
  }
}

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray } from 'drizzle-orm';
import {
  adminUsers,
  aiGenerationPublications,
  aiGenerations,
  enterprises,
  floorPlans,
  leadFloorPlans,
  leads,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  CustomerProjectRepository,
  EnterpriseRepository,
  LeadRepository,
} from '@/db/repositories';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const runKey = `customer-project-${process.pid}-${Date.now()}`;
let enterpriseId: bigint;
let otherEnterpriseId: bigint;
let customerUserId: bigint;
let otherCustomerUserId: bigint;
let designerId: bigint;
let leadId: bigint;
let floorPlanId: bigint;
let generationId: bigint;

before(async () => {
  loadEnvConfig(process.cwd());
  const databaseUrl = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'Customer-project integration tests only mutate the local database');
  await withPlatformTransaction(async (transaction) => {
    const enterprisesRepository = new EnterpriseRepository(transaction);
    enterpriseId = (await enterprisesRepository.create({ name: `${runKey}-main`, code: `${runKey}-main`, status: 'active' })).id;
    otherEnterpriseId = (await enterprisesRepository.create({ name: `${runKey}-other`, code: `${runKey}-other`, status: 'active' })).id;
    const created = await transaction.insert(users).values([
      { phone: `16${String(Date.now()).slice(-9)}`, nickname: `${runKey}-customer` },
      { phone: `15${String(Date.now() + 1).slice(-9)}`, nickname: `${runKey}-other-customer` },
    ]).returning();
    customerUserId = created[0]!.id;
    otherCustomerUserId = created[1]!.id;
  });

  await withTenantTransaction(enterpriseId, async (transaction) => {
    designerId = (await new AdminUserRepository(transaction).create({
      enterpriseId,
      username: `${runKey}-designer`,
      passwordHash: 'test-only',
      displayName: '项目设计师',
      role: 'designer',
      status: 'active',
      assignmentPaused: false,
      wechatId: 'project-designer-wechat',
    })).id;
    const leadRepository = new LeadRepository(transaction);
    leadId = (await leadRepository.create({
      enterpriseId,
      customerUserId,
      assignedTo: designerId,
      name: '项目客户',
      phone: `18${String(Date.now()).slice(-9)}`,
      source: 'customer-project-test',
      assignmentStatus: 'assigned',
    })).id;
    const [floorPlan] = await transaction.insert(floorPlans).values({
      enterpriseId,
      creatorId: customerUserId,
      staffId: designerId,
      name: '正式量房户型',
      source: 'surveying',
      status: 'completed',
      completedAt: new Date(),
      layoutData: { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph' } },
    }).returning();
    floorPlanId = floorPlan!.id;
    await leadRepository.linkFloorPlan(leadId, floorPlanId);
    const [generation] = await transaction.insert(aiGenerations).values({
      enterpriseId,
      operatorId: designerId,
      leadId,
      floorPlanId,
      type: 'miniprogram',
      status: 'succeeded',
      output: { imageUrl: 'https://example.invalid/published-design.png' },
      input: { recipeName: '现代舒居方案' },
    }).returning();
    generationId = generation!.id;
  });
});

after(async () => {
  await withPlatformTransaction(async (transaction) => {
    if (enterpriseId) {
      await transaction.delete(aiGenerationPublications).where(eq(aiGenerationPublications.enterpriseId, enterpriseId));
      await transaction.delete(aiGenerations).where(eq(aiGenerations.enterpriseId, enterpriseId));
      await transaction.delete(leadFloorPlans).where(eq(leadFloorPlans.leadId, leadId));
      await transaction.delete(floorPlans).where(eq(floorPlans.enterpriseId, enterpriseId));
      await transaction.delete(leads).where(eq(leads.enterpriseId, enterpriseId));
      await transaction.delete(adminUsers).where(eq(adminUsers.enterpriseId, enterpriseId));
      await transaction.delete(enterprises).where(inArray(enterprises.id, [enterpriseId, otherEnterpriseId]));
    }
    if (customerUserId && otherCustomerUserId) {
      await transaction.delete(users).where(inArray(users.id, [customerUserId, otherCustomerUserId]));
    }
  });
  await closePostgresPool();
});

test('only the owning customer can aggregate a project, and only active published designs are visible', async () => {
  const unpublished = await withTenantTransaction(enterpriseId, async (transaction) =>
    transaction.insert(aiGenerations).values({
      enterpriseId,
      operatorId: designerId,
      leadId,
      type: 'miniprogram',
      status: 'succeeded',
      output: { imageUrl: 'https://example.invalid/private-design.png' },
    }).returning()
  );
  assert.ok(unpublished[0]);

  const beforePublish = await withTenantTransaction(enterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).findCustomerProject(customerUserId, leadId)
  );
  assert.equal(beforePublish?.formalFloorPlan?.id, floorPlanId);
  assert.equal(beforePublish?.publications.length, 0);
  assert.equal(beforePublish?.designer?.id, designerId);

  const published = await withTenantTransaction(enterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).publish({ enterpriseId, leadId, generationId, publishedBy: designerId })
  );
  assert.equal(published.kind, 'published');

  const project = await withTenantTransaction(enterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).findCustomerProject(customerUserId, leadId)
  );
  assert.deepEqual(project?.publications.map((item) => item.generation.id), [generationId]);
  assert.equal(project?.publications[0]?.generation.output && typeof project.publications[0].generation.output, 'object');

  const forbidden = await withTenantTransaction(enterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).findCustomerProject(otherCustomerUserId, leadId)
  );
  assert.equal(forbidden, null);

  const crossTenant = await withTenantTransaction(otherEnterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).findCustomerProject(customerUserId, leadId)
  );
  assert.equal(crossTenant, null);
});

test('withdrawal immediately hides a customer-visible design without deleting its generation', async () => {
  const withdrawn = await withTenantTransaction(enterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).withdraw({ enterpriseId, leadId, generationId, withdrawnBy: designerId })
  );
  assert.equal(withdrawn.kind, 'withdrawn');

  const project = await withTenantTransaction(enterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).findCustomerProject(customerUserId, leadId)
  );
  assert.equal(project?.publications.length, 0);

  const persisted = await withPlatformTransaction((transaction) =>
    transaction.select().from(aiGenerations).where(eq(aiGenerations.id, generationId)).limit(1)
  );
  assert.equal(persisted[0]?.id, generationId);
});

test('concurrent publication retries create one active customer-visible fact', async () => {
  const results = await Promise.all([
    withTenantTransaction(enterpriseId, (transaction) =>
      new CustomerProjectRepository(transaction).publish({ enterpriseId, leadId, generationId, publishedBy: designerId })
    ),
    withTenantTransaction(enterpriseId, (transaction) =>
      new CustomerProjectRepository(transaction).publish({ enterpriseId, leadId, generationId, publishedBy: designerId })
    ),
  ]);
  assert.deepEqual(results.map((result) => result.kind), ['published', 'published']);

  const project = await withTenantTransaction(enterpriseId, (transaction) =>
    new CustomerProjectRepository(transaction).findCustomerProject(customerUserId, leadId)
  );
  assert.equal(project?.publications.filter((item) => item.generation.id === generationId).length, 1);
});

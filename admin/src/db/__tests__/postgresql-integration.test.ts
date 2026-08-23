import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { count, eq, inArray, like } from 'drizzle-orm';
import {
  aiPromptCategories,
  aiPromptLibraryRevisions,
  aiPromptParameterTemplates,
  aiPromptSourceModels,
  aiPromptTemplateAssets,
  aiPromptTemplates,
  aiCreationModelProfiles,
  aiCreationTasks,
  aiGenerations,
  aiWorkflows,
  mediaAssets,
  aiStylePresets,
  aiProviderConfigs,
  aiCreditPrices,
  aiCreditAccounts,
  aiCreditLedgers,
  aiModelCreditPrices,
  adminUsers,
  departments,
  devices,
  enterpriseCommissionRules,
  enterpriseOrders,
  enterprises,
  floorPlans,
  inspirations,
  leadCommissions,
  leadLifecycleEvents,
  leads,
  mediaStorageConfigs,
  referrerEnterpriseMemberships,
  referrerProfiles,
  packages,
  platformConfigs,
  promotionEnterpriseRecords,
  systemRoles,
  users,
  wechatIdentities,
  workflowNotificationLogs,
} from '@/db/schema';
import {
  AdminUserRepository,
  AiStylePresetRepository,
  AiCreationModelProfileRepository,
  AiCreationRepository,
  AiWorkflowRepository,
  AiProviderConfigRepository,
  AiCreditPriceRepository,
  AiCreditRepository,
  AiModelCreditPriceRepository,
  CommercialRepository,
  DepartmentRepository,
  DeviceRepository,
  EnterpriseRepository,
  EnterpriseAiUsageSnapshotRepository,
  FloorPlanRepository,
  InspirationRepository,
  LeadLifecycleRepository,
  LeadCommissionRepository,
  LeadRepository,
  MediaAssetRepository,
  MediaStorageConfigRepository,
  MiniProgramIdentityRepository,
  PlatformConfigRepository,
  PromptLibraryRepository,
  ReferrerPortalRepository,
  SystemRoleRepository,
  UserRepository,
  MeasurementRepository,
  PackageRepository,
  PromotionRecordRepository,
  WorkflowNotificationRepository,
} from '@/db/repositories';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import { withPromotionPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  createPromotionRecord,
  promotionActorFromContext,
  updatePromotionRecord,
} from '@/lib/postgres-promotion-workflow';
import { listWorkbenchTodos } from '@/lib/postgres-workflow-automation';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import { RENDER_REVISION } from '@/lib/survey-canvas-runtime';
import {
  createPostgresAiWorkflowManualGeneration,
  createPostgresAiWorkflow,
  getPostgresAiWorkflowContext,
  getPostgresAiWorkflowFloorPlanPreview,
  getPostgresAiWorkflowSourceImage,
  listPostgresAiWorkflows,
  preparePostgresAiWorkflowStage,
  updatePostgresAiWorkflowState,
} from '@/lib/ai/postgres-workflow-service';
import { preparePostgresMiniAiTaskRetry } from '@/lib/ai/postgres-mini-ai-tasks';
import { chinaDateString } from '@/lib/lead-conversion';
import { getPurgeBlockers } from '@/lib/lead-lifecycle';
import { enableDefaultResolutionPriceForProfile, listPostgresExecutableImageModelProfiles, listPostgresImageModelPrices, listPostgresWorkbenchImageModels } from '@/lib/ai/image-model-catalog';
import { listAiCreditPrices } from '@/lib/ai/credits';
import { AI_ACTION_KEYS } from '@/lib/ai/provider-types';
import {
  createPostgresCreationTask,
  claimPostgresCreationProviderPolls,
  acknowledgePostgresCreationProviderAttempt,
  attachPostgresCreationProviderResultAsset,
  beginPostgresCreationProviderAttempt,
  completePostgresCreationProviderAttempt,
  consumePostgresCreationGenerationCredits,
  failPostgresCreationProviderAttempt,
  holdPostgresCreationGenerationCredits,
  preparePostgresCreationBatch,
  preparePostgresCreationBatchRetry,
  recordPostgresCreationProviderPollState,
  releasePostgresCreationGenerationCredits,
  refreshPostgresCreationBatchStatus,
  settlePostgresCreationProviderResult,
  settlePostgresCreationProviderUrlResult,
} from '@/lib/ai/postgres-creation-service';
import {
  adjustAiCredits,
  consumeHeldAiCredits,
  grantAiCredits,
  holdAiCredits,
  releaseHeldAiCredits,
} from '@/lib/ai/credits';
import {
  closePostgresPool,
  getPostgresPool,
  resolvePostgresRuntimeConfig,
} from '@/lib/postgresql';

const testRunKey = `phase2-${process.pid}-${Date.now()}`;
const enterpriseCodes = [`${testRunKey}-a`, `${testRunKey}-b`];
const systemRoleKey = `${testRunKey}-role`;
let enterpriseAId: bigint;
let enterpriseBId: bigint;
let promptRevisionId: bigint;
let promptTemplateId: bigint;
const identityAdminIds: bigint[] = [];
const identityUserIds: bigint[] = [];
const packageIds: bigint[] = [];
const promotionRecordIds: bigint[] = [];
let promotionPromoterAId: bigint;
let promotionPromoterA2Id: bigint;
let promotionMeasurerAId: bigint;
let promotionDesignerAId: bigint;
let promotionPromoterBId: bigint;
let aiStylePresetId: bigint;
let aiProviderConfigId: bigint;
let aiCreditAccountId: bigint;
const aiCreditLedgerIds: bigint[] = [];
const aiCreationModelProfileIds: bigint[] = [];

before(async () => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'PostgreSQL integration tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    const repository = new EnterpriseRepository(transaction);
    const enterpriseA = await repository.create({
      name: `${testRunKey} A`,
      code: enterpriseCodes[0],
    });
    const enterpriseB = await repository.create({
      name: `${testRunKey} B`,
      code: enterpriseCodes[1],
    });
    enterpriseAId = enterpriseA.id;
    enterpriseBId = enterpriseB.id;

    const adminRepository = new AdminUserRepository(transaction);
    const promotionStaff = await Promise.all([
      adminRepository.create({
        enterpriseId: enterpriseAId,
        username: `${testRunKey}-promotion-a-1`,
        passwordHash: 'test-hash',
        displayName: 'Promotion A 1',
        role: 'salesperson',
        menuPermissions: ['dashboard'],
      }),
      adminRepository.create({
        enterpriseId: enterpriseAId,
        username: `${testRunKey}-promotion-a-2`,
        passwordHash: 'test-hash',
        displayName: 'Promotion A 2',
        role: 'salesperson',
        menuPermissions: ['dashboard'],
      }),
      adminRepository.create({
        enterpriseId: enterpriseAId,
        username: `${testRunKey}-promotion-measurer`,
        passwordHash: 'test-hash',
        displayName: 'Promotion Measurer',
        role: 'measurer',
        menuPermissions: ['dashboard'],
      }),
      adminRepository.create({
        enterpriseId: enterpriseAId,
        username: `${testRunKey}-promotion-designer`,
        passwordHash: 'test-hash',
        displayName: 'Promotion Designer',
        role: 'designer',
        menuPermissions: ['dashboard'],
      }),
      adminRepository.create({
        enterpriseId: enterpriseBId,
        username: `${testRunKey}-promotion-b`,
        passwordHash: 'test-hash',
        displayName: 'Promotion B',
        role: 'salesperson',
        menuPermissions: ['dashboard'],
      }),
    ]);
    [
      promotionPromoterAId,
      promotionPromoterA2Id,
      promotionMeasurerAId,
      promotionDesignerAId,
      promotionPromoterBId,
    ] = promotionStaff.map((staff) => staff.id);
    identityAdminIds.push(...promotionStaff.map((staff) => staff.id));

    const departmentsRepository = new DepartmentRepository(transaction);
    await departmentsRepository.create({
      enterpriseId: enterpriseAId,
      name: 'Tenant A Department',
    });
    await departmentsRepository.create({
      enterpriseId: enterpriseBId,
      name: 'Tenant B Department',
    });

    const revision = await transaction
      .insert(aiPromptLibraryRevisions)
      .values({
        source: testRunKey,
        revisionKey: `${testRunKey}-revision`,
        status: 'active',
        manifestHash: 'manifest',
        contentHash: 'content',
      })
      .returning({ id: aiPromptLibraryRevisions.id });
    promptRevisionId = revision[0].id;

    const category = await transaction
      .insert(aiPromptCategories)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-category`,
        sourceHash: 'category-hash',
        importedAt: new Date(),
        level: 1,
        name: 'Test category',
        weight: 10,
      })
      .returning({ id: aiPromptCategories.id });
    const parameterTemplate = await transaction
      .insert(aiPromptParameterTemplates)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-parameters`,
        sourceHash: 'parameter-hash',
        importedAt: new Date(),
        name: 'Test parameters',
        parameters: { ratio: ['1:1'] },
      })
      .returning({ id: aiPromptParameterTemplates.id });
    const sourceModel = await transaction
      .insert(aiPromptSourceModels)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-model`,
        sourceHash: 'model-hash',
        importedAt: new Date(),
        name: 'Test model',
        localModelProfileId: null,
        capabilities: { image: true },
      })
      .returning({ id: aiPromptSourceModels.id });
    const asset = await transaction
      .insert(aiPromptTemplateAssets)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-asset`,
        templateSourceId: `${testRunKey}-template`,
        sourceHash: 'asset-hash',
        importedAt: new Date(),
        sourceUrl: 'https://example.test/preview.png',
        mimeType: 'image/png',
        size: 4n,
        width: 2,
        height: 2,
        checksumSha256: 'asset-checksum',
        storageProvider: 'local',
        storageKey: `${testRunKey}/preview.png`,
      })
      .returning({ id: aiPromptTemplateAssets.id });
    const template = await transaction
      .insert(aiPromptTemplates)
      .values({
        importRevisionId: promptRevisionId,
        categoryId: category[0].id,
        sourceModelId: sourceModel[0].id,
        parameterTemplateId: parameterTemplate[0].id,
        previewAssetId: asset[0].id,
        source: testRunKey,
        sourceId: `${testRunKey}-template`,
        sourceHash: 'template-hash',
        importedAt: new Date(),
        name: 'Test template',
        promptContent: 'A test prompt',
        categorySourceId: `${testRunKey}-category`,
        bestModelSourceId: `${testRunKey}-model`,
        parameterTemplateSourceId: `${testRunKey}-parameters`,
      })
      .returning({ id: aiPromptTemplates.id });
    promptTemplateId = template[0].id;
  });
});

test('AI style presets use idempotent PostgreSQL defaults and preserve JSON image fields on update', async () => {
  const key = `${testRunKey}-preset`;
  await withPlatformTransaction(async (transaction) => {
    const repository = new AiStylePresetRepository(transaction);
    await repository.ensureDefaults([
      {
        key,
        type: 'scenario',
        name: 'PostgreSQL preset',
        promptTemplate: 'A test prompt',
        negativePrompt: 'No test artifacts',
        image: {
          model: 'test-model',
          size: '1024x1024',
          quality: 'medium',
          mode: 'edit',
        },
        enabled: true,
        sortOrder: 11,
      },
    ]);
    await repository.ensureDefaults([
      {
        key,
        type: 'scenario',
        name: 'Duplicate must not replace',
        promptTemplate: 'Changed prompt',
      },
    ]);
    const created = await repository.findEnabledByTypeAndKey('scenario', key);
    assert.ok(created);
    assert.equal(created.name, 'PostgreSQL preset');
    aiStylePresetId = created.id;

    const updated = await repository.update(created.id, {
      name: 'Updated PostgreSQL preset',
      image: {
        ...created.image,
        quality: 'high',
      },
    });
    assert.equal(updated?.name, 'Updated PostgreSQL preset');
    assert.equal(updated?.image?.model, 'test-model');
    assert.equal(updated?.image?.quality, 'high');
  });

  const listed = await withPlatformTransaction((transaction) =>
    new AiStylePresetRepository(transaction).list({ type: 'scenario' })
  );
  assert.equal(listed.some((preset) => preset.id === aiStylePresetId), true);
});

test('AI provider configuration keeps encrypted credentials and operational state in PostgreSQL', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new AiProviderConfigRepository(transaction);
    const created = await repository.create({
      key: `${testRunKey}-provider`,
      name: 'PostgreSQL test provider',
      adapterType: 'grs',
      baseUrl: 'https://provider.example.test',
      apiKeyEncrypted: 'encrypted-test-key',
      apiKeyMasked: 'test***key',
      credentialsEncrypted: { apiKey: 'encrypted-test-key' },
      credentialsMasked: { apiKey: 'test***key' },
      adapterConfig: { retry: 1 },
      capabilities: ['image.generate'],
      modelMappings: { 'image.generate.standard': 'test-model' },
      priority: 7,
      timeoutMs: 30_000,
      enabled: true,
      costRules: [],
    });
    aiProviderConfigId = created.id;

    const enabled = await repository.listEnabled({
      capability: 'image.generate',
      adapterType: 'grs',
    });
    assert.equal(enabled.some((record) => record.id === created.id), true);

    const updated = await repository.update(created.id, {
      priority: 5,
      operationalState: { lastTestOk: true, discoveredModels: ['test-model'] },
    });
    assert.equal(updated?.priority, 5);
    assert.deepEqual(updated?.operationalState, {
      lastTestOk: true,
      discoveredModels: ['test-model'],
    });
  });
});

test('AI credit prices use idempotent PostgreSQL defaults and bigint-safe updates', async () => {
  await withPlatformTransaction(async (transaction) => {
    const prices = new AiCreditPriceRepository(transaction);
    await prices.ensureDefaults([
      {
        actionKey: `${testRunKey}.price`,
        mode: null,
        label: 'PostgreSQL test action',
        credits: BigInt(12),
        enabled: true,
      },
    ]);
    await prices.ensureDefaults([
      {
        actionKey: `${testRunKey}.price`,
        mode: null,
        label: 'Must not overwrite',
        credits: BigInt(99),
        enabled: false,
      },
    ]);
    const listed = await prices.list();
    const created = listed.find((price) => price.actionKey === `${testRunKey}.price`);
    assert.ok(created);
    assert.equal(created.credits, BigInt(12));
    assert.equal((await prices.findEnabledByActionKey(created.actionKey))?.id, created.id);
    const updated = await prices.updateByActionKey(created.actionKey, {
      credits: BigInt(18),
      enabled: true,
      updatedBy: null,
    });
    assert.equal(updated?.credits, BigInt(18));
  });

  await withPlatformTransaction(async (transaction) => {
    const prices = new AiModelCreditPriceRepository(transaction);
    await prices.ensureDefault({
      actionKey: 'image.free_create',
      modelProfileKey: `${testRunKey}.model`,
      resolutionTier: '1K',
      label: 'PostgreSQL test model',
      credits: BigInt(20),
      enabled: true,
      updatedBy: null,
    });
    const created = await prices.findEnabled(`${testRunKey}.model`, '1K');
    assert.ok(created);
    assert.equal(created.credits, BigInt(20));
    const updated = await prices.update(`${testRunKey}.model`, '1K', {
      credits: BigInt(25),
      enabled: false,
      updatedBy: null,
    });
    assert.equal(updated?.credits, BigInt(25));
    assert.equal((await prices.findEnabled(`${testRunKey}.model`, '1K')), null);
  });
});

test('platform credit and model price listings ignore leftover non-catalog keys', async () => {
  const listed = await listAiCreditPrices();
  assert.equal(listed.some((price) => price.actionKey === `${testRunKey}.price`), false);
  assert.ok(listed.every((price) => (AI_ACTION_KEYS as readonly string[]).includes(price.actionKey)));

  const modelPrices = await listPostgresImageModelPrices();
  assert.equal(modelPrices.some((price) => price.modelProfileKey === `${testRunKey}.model`), false);
  assert.ok(modelPrices.every((price) => price.modelProfileKey.startsWith('grs-')));
});

test('AI credit accounts and ledgers apply idempotent balance operations in PostgreSQL', async () => {
  const enterpriseId = enterpriseAId.toString();
  const operatorId = promotionPromoterAId.toString();
  const operationPrefix = `${testRunKey}.credits`;

  const granted = await grantAiCredits({
    enterpriseId,
    operatorId,
    amount: 100,
    operationId: `${operationPrefix}.grant`,
    note: 'PostgreSQL integration test grant',
  });
  aiCreditAccountId = granted.account.id;
  aiCreditLedgerIds.push(granted.ledger.id);
  assert.equal(granted.account.balance, BigInt(100));
  assert.equal(granted.account.frozenBalance, BigInt(0));

  const duplicateGrant = await grantAiCredits({
    enterpriseId,
    operatorId,
    amount: 100,
    operationId: `${operationPrefix}.grant`,
    note: 'Must not apply twice',
  });
  assert.equal(duplicateGrant.ledger.id, granted.ledger.id);
  assert.equal(duplicateGrant.account.balance, BigInt(100));

  await assert.rejects(
    () => grantAiCredits({
      enterpriseId: enterpriseBId.toString(),
      operatorId,
      amount: 100,
      operationId: `${operationPrefix}.grant`,
      note: 'Cross-tenant operation replay',
    }),
    { message: 'AI credit operation could not be claimed' }
  );

  const held = await holdAiCredits({
    enterpriseId,
    operatorId,
    generationId: 'legacy-generation-id',
    amount: 30,
    operationId: `${operationPrefix}.hold`,
  });
  aiCreditLedgerIds.push(held.ledger.id);
  assert.equal(held.account.frozenBalance, BigInt(30));
  assert.equal(held.ledger.generationId, null);

  const consumed = await consumeHeldAiCredits({
    enterpriseId,
    operatorId,
    generationId: 'legacy-generation-id',
    amount: 20,
    operationId: `${operationPrefix}.consume`,
  });
  aiCreditLedgerIds.push(consumed.ledger.id);
  assert.equal(consumed.account.balance, BigInt(80));
  assert.equal(consumed.account.frozenBalance, BigInt(10));

  const released = await releaseHeldAiCredits({
    enterpriseId,
    operatorId,
    generationId: 'legacy-generation-id',
    amount: 10,
    operationId: `${operationPrefix}.release`,
  });
  aiCreditLedgerIds.push(released.ledger.id);
  assert.equal(released.account.frozenBalance, BigInt(0));

  const adjusted = await adjustAiCredits({
    enterpriseId,
    operatorId,
    amount: -30,
    operationId: `${operationPrefix}.adjust`,
    note: 'PostgreSQL integration test adjustment',
  });
  aiCreditLedgerIds.push(adjusted.ledger.id);
  assert.equal(adjusted.account.balance, BigInt(50));

  await assert.rejects(
    () => holdAiCredits({
      enterpriseId,
      operatorId,
      generationId: 'legacy-generation-id',
      amount: 51,
      operationId: `${operationPrefix}.insufficient`,
    }),
    { name: 'Error' }
  );

  await withTenantTransaction(enterpriseAId, async (transaction) => {
    const ledger = await new AiCreditRepository(transaction).listWithOperators(enterpriseAId);
    assert.equal(ledger.some((item) => item.ledger.operationId === `${operationPrefix}.grant`), true);
    aiCreditLedgerIds.push(
      ...ledger
        .filter((item) => item.ledger.operationId.startsWith(operationPrefix))
        .map((item) => item.ledger.id)
    );
  });
});

test('AI creation policy reads a PostgreSQL enterprise identity without ObjectId casting', async () => {
  await withTenantTransaction(enterpriseAId, async (transaction) => {
    await new EnterpriseRepository(transaction).update(enterpriseAId, {
      aiPolicy: { enabledActionKeys: ['image.free_create'] },
    });
  });

  const policy = await getEnterpriseAiPolicy(enterpriseAId.toString());
  assert.deepEqual(policy.enabledActionKeys, ['image.free_create']);
});

test('lead archive lifecycle filters active rows and restores the original business state', async () => {
  let leadId: bigint | null = null;
  const phone = `135${String(Date.now()).slice(-8)}`;
  try {
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const leadRepository = new LeadRepository(transaction);
      const lifecycleRepository = new LeadLifecycleRepository(transaction);
      const lead = await leadRepository.create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Archive lifecycle integration lead',
        phone,
        source: 'integration-test',
        status: 'closed',
      });
      leadId = lead.id;

      assert.equal((await leadRepository.list({ phone })).total, 1);
      await lifecycleRepository.lockByIds([lead.id]);
      const [impact] = await lifecycleRepository.impacts([lead.id]);
      assert.ok(impact);
      const archived = await lifecycleRepository.archive({
        leadId: lead.id,
        actorId: promotionDesignerAId,
        reason: 'duplicate',
        note: 'integration test',
        impact,
      });
      assert.equal(archived?.status, 'closed');
      assert.equal((await leadRepository.list({ phone })).total, 0);
      assert.equal((await leadRepository.list({ phone, archiveState: 'archived' })).total, 1);
      assert.equal((await leadRepository.findByPhone(phone))?.id, lead.id);

      await lifecycleRepository.lockByIds([lead.id]);
      const restored = await lifecycleRepository.restore(lead.id, promotionDesignerAId);
      assert.equal(restored?.status, 'closed');
      assert.equal(restored?.archivedAt, null);
      assert.equal((await leadRepository.list({ phone })).total, 1);
      assert.equal((await leadRepository.list({ phone, archiveState: 'archived' })).total, 0);

      const events = await transaction
        .select()
        .from(leadLifecycleEvents)
        .where(eq(leadLifecycleEvents.leadRecordId, lead.id));
      assert.deepEqual(events.map((event) => event.action).sort(), ['archived', 'restored']);
      assert.equal(JSON.stringify(events, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ).includes(phone), false);
    });

    const crossTenantLead = await withTenantTransaction(enterpriseBId, (transaction) =>
      new LeadRepository(transaction).findById(leadId!)
    );
    assert.equal(crossTenantLead, null);
  } finally {
    if (leadId) {
      await withPlatformTransaction(async (transaction) => {
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, leadId!));
        await transaction.delete(leads).where(eq(leads.id, leadId!));
      });
    }
  }
});

test('lead conversion is atomic, protected from generic status writes, revertible, and purge-blocking', async () => {
  let leadId: bigint | null = null;
  const phone = `134${String(Date.now()).slice(-8)}`;
  try {
    leadId = await withTenantTransaction(enterpriseAId, async (transaction) => {
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Lead conversion integration test',
        phone,
        source: 'integration-test',
        status: 'designing',
      });
      return lead.id;
    });

    const attempts = await Promise.allSettled([
      withTenantTransaction(enterpriseAId, (transaction) =>
        new LeadLifecycleRepository(transaction).convert({
          leadId: leadId!,
          actorId: promotionDesignerAId,
          convertedOn: chinaDateString(),
          contractAmount: '128000.50',
          conversionNote: 'integration conversion',
        })
      ),
      withTenantTransaction(enterpriseAId, (transaction) =>
        new LeadLifecycleRepository(transaction).convert({
          leadId: leadId!,
          actorId: promotionDesignerAId,
          convertedOn: chinaDateString(),
          contractAmount: null,
          conversionNote: null,
        })
      ),
    ]);
    assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((item) => item.status === 'rejected').length, 1);

    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const repository = new LeadRepository(transaction);
      const converted = await repository.findById(leadId!);
      assert.equal(converted?.status, 'converted');
      assert.equal(converted?.convertedOn, chinaDateString());
      assert.equal(converted?.convertedBy, promotionDesignerAId);
      await assert.rejects(
        () => repository.update(leadId!, { status: 'measuring' }),
        /专用签约操作/
      );

      const [impact] = await new LeadLifecycleRepository(transaction).impacts([leadId!]);
      assert.equal(impact.hasConversion, true);
      assert.equal(getPurgeBlockers({ ...impact, archived: true }).includes('存在客户签约事实'), true);
    });

    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const lifecycle = new LeadLifecycleRepository(transaction);
      const reverted = await lifecycle.revertConversion({
        leadId: leadId!,
        actorId: promotionDesignerAId,
        reason: 'integration correction',
      });
      assert.equal(reverted?.status, 'designing');
      assert.equal(reverted?.convertedAt, null);
      assert.equal(reverted?.contractAmount, null);
      const events = await transaction
        .select()
        .from(leadLifecycleEvents)
        .where(eq(leadLifecycleEvents.leadRecordId, leadId!));
      assert.deepEqual(events.map((event) => event.action).sort(), [
        'conversion_reverted',
        'converted',
      ]);
      const [impactAfterRevert] = await lifecycle.impacts([leadId!]);
      assert.equal(impactAfterRevert.hasConversion, true);
      assert.equal(
        getPurgeBlockers({ ...impactAfterRevert, archived: true }).includes('存在客户签约事实'),
        true
      );
    });
  } finally {
    if (leadId) {
      await withPlatformTransaction(async (transaction) => {
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, leadId!));
        await transaction.delete(leads).where(eq(leads.id, leadId!));
      });
    }
  }
});

test('referral signing snapshots three decimal-safe commissions and voids unpaid records on reversion', async () => {
  let leadId: bigint | null = null;
  let paidBlockerLeadId: bigint | null = null;
  let concurrentLeadId: bigint | null = null;
  let membershipId: bigint | null = null;
  let designerId: bigint | null = null;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const createdUserIds: bigint[] = [];
  const createdStaffIds: bigint[] = [];
  try {
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const [referrerUser, designerUser, measurerUser, customerUser] = await transaction.insert(users).values([
        { enterpriseId: enterpriseAId, nickname: `Commission referrer ${suffix}`, phone: `159${String(Date.now()).slice(-8)}` },
        { enterpriseId: enterpriseAId, nickname: `Commission designer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Commission measurer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Commission customer ${suffix}` },
      ]).returning({ id: users.id });
      createdUserIds.push(referrerUser.id, designerUser.id, measurerUser.id, customerUser.id);
      const staffRepository = new AdminUserRepository(transaction);
      const [designer, measurer] = await Promise.all([
        staffRepository.create({ enterpriseId: enterpriseAId, userId: designerUser.id, username: `${testRunKey}-commission-designer-${suffix}`, passwordHash: 'test-hash', displayName: 'Commission Designer', role: 'designer' }),
        staffRepository.create({ enterpriseId: enterpriseAId, userId: measurerUser.id, username: `${testRunKey}-commission-measurer-${suffix}`, passwordHash: 'test-hash', displayName: 'Commission Measurer', role: 'measurer' }),
      ]);
      designerId = designer.id;
      createdStaffIds.push(designer.id, measurer.id);
      const [profile] = await transaction.insert(referrerProfiles).values({ userId: referrerUser.id, displayName: 'Commission Referrer' }).returning();
      const [membership] = await transaction.insert(referrerEnterpriseMemberships).values({ referrerId: profile.id, enterpriseId: enterpriseAId }).returning();
      membershipId = membership.id;
      const commissionRepository = new LeadCommissionRepository(transaction);
      await commissionRepository.updateRules(enterpriseAId, designer.id, [
        { role: 'referrer', calculationType: 'percentage', value: '12.5000', status: 'active', version: 1 },
        { role: 'designer', calculationType: 'fixed', value: '88.1250', status: 'active', version: 1 },
        { role: 'measurer', calculationType: 'fixed', value: '10.0000', status: 'active', version: 1 },
      ]);
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        referrerMembershipId: membership.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Three-role commission lead',
        phone: `133${String(Date.now()).slice(-8)}`,
        source: 'referral-commission-test',
        status: 'designing',
      });
      leadId = lead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: lead.id,
        actorId: designer.id,
        convertedOn: chinaDateString(),
        contractAmount: '1000.00',
        conversionNote: null,
      });
      const commissions = await commissionRepository.list(enterpriseAId, { leadId: lead.id });
      assert.deepEqual(commissions.map((item) => [item.role, item.payableAmount]).sort(), [
        ['designer', '88.13'],
        ['measurer', '10.00'],
        ['referrer', '125.00'],
      ]);
      assert.equal(commissions.every((item) => item.status === 'payable'), true);
      assert.equal(
        commissions.every(
          (item) =>
            item.originalPayableAmount === item.payableAmount &&
            item.originalBeneficiaryUserId === item.beneficiaryUserId &&
            item.adjustedAt == null &&
            item.adjustedBy == null &&
            item.adjustReason == null
        ),
        true
      );
      const referrerCommission = commissions.find((item) => item.role === 'referrer');
      assert.equal(referrerCommission?.enterprise?.name.includes(testRunKey), true);
      assert.equal(referrerCommission?.customer?.id, customerUser.id);
      assert.equal(referrerCommission?.referrer?.userId, referrerUser.id);
      assert.equal(referrerCommission?.designer?.staffId, designer.id);
      assert.equal(referrerCommission?.measurer?.staffId, measurer.id);
      assert.equal(referrerCommission?.appointment, null);
      assert.equal((await commissionRepository.list(enterpriseAId, { leadId: lead.id, role: 'designer' })).length, 1);
      assert.equal((await commissionRepository.list(enterpriseAId, { leadId: lead.id, status: 'payable', createdFrom: new Date(commissions[0].createdAt.getTime() - 1), createdBefore: new Date(commissions[0].createdAt.getTime() + 1) })).length, 3);

      await new LeadLifecycleRepository(transaction).revertConversion({
        leadId: lead.id,
        actorId: designer.id,
        reason: 'contract correction',
      });
      const voided = await commissionRepository.list(enterpriseAId, { leadId: lead.id });
      assert.equal(voided.every((item) => item.status === 'voided' && item.voidReason === 'contract correction'), true);

      const paidBlockerLead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        referrerMembershipId: membership.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Paid commission reversal blocker',
        phone: `132${String(Date.now()).slice(-8)}`,
        source: 'referral-commission-test',
        status: 'designing',
      });
      paidBlockerLeadId = paidBlockerLead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: paidBlockerLead.id, actorId: designer.id, convertedOn: chinaDateString(), contractAmount: '1000.00', conversionNote: null,
      });
      const payable = await commissionRepository.list(enterpriseAId, { leadId: paidBlockerLead.id });
      await commissionRepository.markPaid(enterpriseAId, [payable[0].id], designer.id);
      await assert.rejects(
        () => new LeadLifecycleRepository(transaction).revertConversion({ leadId: paidBlockerLead.id, actorId: designer.id, reason: 'must be blocked' }),
        /已支付提成/
      );

      const concurrentLead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        referrerMembershipId: membership.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Concurrent commission snapshot',
        phone: `131${String(Date.now()).slice(-8)}`,
        source: 'referral-commission-test',
        status: 'designing',
      });
      concurrentLeadId = concurrentLead.id;
    });
    const concurrentConversions = await Promise.allSettled([
      withTenantTransaction(enterpriseAId, (transaction) => new LeadLifecycleRepository(transaction).convert({
        leadId: concurrentLeadId!, actorId: designerId!, convertedOn: chinaDateString(), contractAmount: '1000.00', conversionNote: null,
      })),
      withTenantTransaction(enterpriseAId, (transaction) => new LeadLifecycleRepository(transaction).convert({
        leadId: concurrentLeadId!, actorId: designerId!, convertedOn: chinaDateString(), contractAmount: '1000.00', conversionNote: null,
      })),
    ]);
    assert.equal(concurrentConversions.filter((item) => item.status === 'fulfilled').length, 1);
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const commissions = await new LeadCommissionRepository(transaction).list(enterpriseAId, { leadId: concurrentLeadId! });
      assert.equal(commissions.length, 3);
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (leadId) {
        await transaction.delete(leadCommissions).where(eq(leadCommissions.leadId, leadId));
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, leadId));
        await transaction.delete(leads).where(eq(leads.id, leadId));
      }
      if (paidBlockerLeadId) {
        await transaction.delete(leadCommissions).where(eq(leadCommissions.leadId, paidBlockerLeadId));
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, paidBlockerLeadId));
        await transaction.delete(leads).where(eq(leads.id, paidBlockerLeadId));
      }
      if (concurrentLeadId) {
        await transaction.delete(leadCommissions).where(eq(leadCommissions.leadId, concurrentLeadId));
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, concurrentLeadId));
        await transaction.delete(leads).where(eq(leads.id, concurrentLeadId));
      }
      if (membershipId) {
        await transaction.delete(referrerEnterpriseMemberships).where(eq(referrerEnterpriseMemberships.id, membershipId));
      }
      await transaction.delete(enterpriseCommissionRules).where(eq(enterpriseCommissionRules.enterpriseId, enterpriseAId));
      if (createdStaffIds.length) await transaction.delete(adminUsers).where(inArray(adminUsers.id, createdStaffIds));
      if (createdUserIds.length) await transaction.delete(users).where(inArray(users.id, createdUserIds));
    });
  }
});

test('staff activity conversion snapshots designer and measurer rows even when they share a beneficiary', async () => {
  let leadId: bigint | null = null;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const createdUserIds: bigint[] = [];
  const createdStaffIds: bigint[] = [];
  try {
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const [designerUser, customerUser] = await transaction.insert(users).values([
        { enterpriseId: enterpriseAId, nickname: `Activity designer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Activity customer ${suffix}` },
      ]).returning({ id: users.id });
      createdUserIds.push(designerUser.id, customerUser.id);
      const designer = await new AdminUserRepository(transaction).create({
        enterpriseId: enterpriseAId,
        userId: designerUser.id,
        username: `${testRunKey}-activity-designer-${suffix}`,
        passwordHash: 'test-hash',
        displayName: 'Activity Dual Staff',
        role: 'designer',
      });
      createdStaffIds.push(designer.id);
      const commissionRepository = new LeadCommissionRepository(transaction);
      await commissionRepository.updateRules(enterpriseAId, designer.id, [
        { role: 'referrer', calculationType: 'fixed', value: '10.0000', status: 'disabled', version: 1 },
        { role: 'designer', calculationType: 'fixed', value: '88.0000', status: 'active', version: 1 },
        { role: 'measurer', calculationType: 'fixed', value: '22.0000', status: 'active', version: 1 },
      ]);
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        assignedTo: designer.id,
        measurerId: designer.id,
        name: 'Staff activity commission lead',
        phone: `134${String(Date.now()).slice(-8)}`,
        source: 'staff_activity',
        status: 'designing',
      });
      leadId = lead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: lead.id,
        actorId: designer.id,
        convertedOn: chinaDateString(),
        contractAmount: '1000.00',
        conversionNote: null,
      });
      const commissions = await commissionRepository.list(enterpriseAId, { leadId: lead.id, source: 'staff_activity' });
      assert.equal(commissions.length, 2);
      assert.deepEqual(
        commissions.map((item) => [item.role, item.payableAmount]).sort(),
        [['designer', '88.00'], ['measurer', '22.00']]
      );
      assert.equal(commissions.every((item) => item.beneficiaryUserId === designerUser.id && item.status === 'payable'), true);
      assert.equal(
        commissions.every(
          (item) =>
            item.originalPayableAmount === item.payableAmount &&
            item.originalBeneficiaryUserId === item.beneficiaryUserId &&
            item.adjustedAt == null
        ),
        true
      );
      assert.equal((await commissionRepository.list(enterpriseAId, { leadId: lead.id, source: 'referrer_network' })).length, 0);
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (leadId) {
        await transaction.delete(leadCommissions).where(eq(leadCommissions.leadId, leadId));
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, leadId));
        await transaction.delete(leads).where(eq(leads.id, leadId));
      }
      await transaction.delete(enterpriseCommissionRules).where(eq(enterpriseCommissionRules.enterpriseId, enterpriseAId));
      if (createdStaffIds.length) await transaction.delete(adminUsers).where(inArray(adminUsers.id, createdStaffIds));
      if (createdUserIds.length) await transaction.delete(users).where(inArray(users.id, createdUserIds));
    });
  }
});

test('manual entry conversion snapshots designer and measurer rows without a referrer', async () => {
  let leadId: bigint | null = null;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const createdUserIds: bigint[] = [];
  const createdStaffIds: bigint[] = [];
  try {
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const [designerUser, measurerUser] = await transaction.insert(users).values([
        { enterpriseId: enterpriseAId, nickname: `Manual designer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Manual measurer ${suffix}` },
      ]).returning({ id: users.id });
      createdUserIds.push(designerUser.id, measurerUser.id);
      const designer = await new AdminUserRepository(transaction).create({
        enterpriseId: enterpriseAId,
        userId: designerUser.id,
        username: `${testRunKey}-manual-designer-${suffix}`,
        passwordHash: 'test-hash',
        displayName: 'Manual Designer',
        role: 'designer',
      });
      const measurer = await new AdminUserRepository(transaction).create({
        enterpriseId: enterpriseAId,
        userId: measurerUser.id,
        username: `${testRunKey}-manual-measurer-${suffix}`,
        passwordHash: 'test-hash',
        displayName: 'Manual Measurer',
        role: 'measurer',
      });
      createdStaffIds.push(designer.id, measurer.id);
      const commissionRepository = new LeadCommissionRepository(transaction);
      await commissionRepository.updateRules(enterpriseAId, designer.id, [
        { role: 'referrer', calculationType: 'fixed', value: '10.0000', status: 'active', version: 1 },
        { role: 'designer', calculationType: 'fixed', value: '80.0000', status: 'active', version: 1 },
        { role: 'measurer', calculationType: 'fixed', value: '20.0000', status: 'active', version: 1 },
      ]);
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Manual entry commission lead',
        phone: `135${String(Date.now()).slice(-8)}`,
        source: 'manual_entry',
        status: 'designing',
      });
      leadId = lead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: lead.id,
        actorId: designer.id,
        convertedOn: chinaDateString(),
        contractAmount: '2000.00',
        conversionNote: null,
      });
      const commissions = await commissionRepository.list(enterpriseAId, { leadId: lead.id, source: 'manual_entry' });
      assert.equal(commissions.length, 2);
      assert.deepEqual(
        commissions.map((item) => [item.role, item.payableAmount]).sort(),
        [['designer', '80.00'], ['measurer', '20.00']]
      );
      assert.equal((await commissionRepository.list(enterpriseAId, { leadId: lead.id, source: 'staff_activity' })).length, 0);
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (leadId) {
        await transaction.delete(leadCommissions).where(eq(leadCommissions.leadId, leadId));
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, leadId));
        await transaction.delete(leads).where(eq(leads.id, leadId));
      }
      await transaction.delete(enterpriseCommissionRules).where(eq(enterpriseCommissionRules.enterpriseId, enterpriseAId));
      if (createdStaffIds.length) await transaction.delete(adminUsers).where(inArray(adminUsers.id, createdStaffIds));
      if (createdUserIds.length) await transaction.delete(users).where(inArray(users.id, createdUserIds));
    });
  }
});

test('commission report reads referrer profile when the base user has no tenant', async () => {
  let leadId: bigint | null = null;
  let membershipId: bigint | null = null;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const createdUserIds: bigint[] = [];
  const createdStaffIds: bigint[] = [];
  try {
    let referrerUserId: bigint | null = null;
    await withPlatformTransaction(async (transaction) => {
      const [referrerUser] = await transaction.insert(users).values([
        { nickname: `Tenantless referrer ${suffix}`, phone: `158${String(Date.now()).slice(-8)}` },
      ]).returning({ id: users.id });
      referrerUserId = referrerUser.id;
      createdUserIds.push(referrerUser.id);
    });
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const [designerUser, measurerUser, customerUser] = await transaction.insert(users).values([
        { enterpriseId: enterpriseAId, nickname: `Profile designer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Profile measurer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Profile customer ${suffix}` },
      ]).returning({ id: users.id });
      createdUserIds.push(designerUser.id, measurerUser.id, customerUser.id);
      const staffRepository = new AdminUserRepository(transaction);
      const [designer, measurer] = await Promise.all([
        staffRepository.create({
          enterpriseId: enterpriseAId,
          userId: designerUser.id,
          username: `${testRunKey}-profile-designer-${suffix}`,
          passwordHash: 'test-hash',
          displayName: 'Profile Designer',
          role: 'designer',
        }),
        staffRepository.create({
          enterpriseId: enterpriseAId,
          userId: measurerUser.id,
          username: `${testRunKey}-profile-measurer-${suffix}`,
          passwordHash: 'test-hash',
          displayName: 'Profile Measurer',
          role: 'measurer',
        }),
      ]);
      createdStaffIds.push(designer.id, measurer.id);
      const [profile] = await transaction.insert(referrerProfiles).values({
        userId: referrerUserId!,
        displayName: 'grh推荐人',
        phone: '13164649401',
      }).returning();
      const [membership] = await transaction.insert(referrerEnterpriseMemberships).values({
        referrerId: profile.id,
        enterpriseId: enterpriseAId,
      }).returning();
      membershipId = membership.id;
      const commissionRepository = new LeadCommissionRepository(transaction);
      await commissionRepository.updateRules(enterpriseAId, designer.id, [
        { role: 'referrer', calculationType: 'fixed', value: '10.0000', status: 'active', version: 1 },
        { role: 'designer', calculationType: 'fixed', value: '20.0000', status: 'active', version: 1 },
        { role: 'measurer', calculationType: 'fixed', value: '30.0000', status: 'active', version: 1 },
      ]);
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        referrerMembershipId: membership.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Tenantless referrer commission lead',
        phone: `157${String(Date.now()).slice(-8)}`,
        source: 'referrer_network',
        status: 'designing',
      });
      leadId = lead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: lead.id,
        actorId: designer.id,
        convertedOn: chinaDateString(),
        contractAmount: '1000.00',
        conversionNote: null,
      });
      const commissions = await commissionRepository.list(enterpriseAId, { leadId: lead.id });
      assert.deepEqual(commissions.map((item) => item.role).sort(), ['designer', 'measurer', 'referrer']);
      assert.equal(commissions.every((item) => item.referrer?.nickname === 'grh推荐人'), true);
      assert.equal(commissions.every((item) => item.referrer?.phone === '13164649401'), true);
      assert.equal(commissions.every((item) => item.referrer?.userId === referrerUserId), true);
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (leadId) {
        await transaction.delete(leadCommissions).where(eq(leadCommissions.leadId, leadId));
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, leadId));
        await transaction.delete(leads).where(eq(leads.id, leadId));
      }
      if (membershipId) {
        await transaction.delete(referrerEnterpriseMemberships).where(eq(referrerEnterpriseMemberships.id, membershipId));
      }
      if (createdUserIds.length) {
        await transaction.delete(referrerProfiles).where(inArray(referrerProfiles.userId, createdUserIds));
      }
      await transaction.delete(enterpriseCommissionRules).where(eq(enterpriseCommissionRules.enterpriseId, enterpriseAId));
      if (createdStaffIds.length) await transaction.delete(adminUsers).where(inArray(adminUsers.id, createdStaffIds));
      if (createdUserIds.length) await transaction.delete(users).where(inArray(users.id, createdUserIds));
    });
  }
});

test('payable commission adjust updates amount or beneficiary, rejects paid/voided and ineligible targets, and keeps markPaid/void/listEarnings consistent', async () => {
  let adjustLeadId: bigint | null = null;
  let paidLeadId: bigint | null = null;
  let voidLeadId: bigint | null = null;
  let membershipAId: bigint | null = null;
  let membershipBId: bigint | null = null;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const createdUserIds: bigint[] = [];
  const createdStaffIds: bigint[] = [];
  try {
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const [referrerA, referrerB, designerUser, designerAltUser, measurerUser, customerUser] = await transaction.insert(users).values([
        { enterpriseId: enterpriseAId, nickname: `Adjust referrer A ${suffix}`, phone: `151${String(Date.now()).slice(-8)}` },
        { enterpriseId: enterpriseAId, nickname: `Adjust referrer B ${suffix}`, phone: `152${String(Date.now()).slice(-8)}` },
        { enterpriseId: enterpriseAId, nickname: `Adjust designer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Adjust designer alt ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Adjust measurer ${suffix}` },
        { enterpriseId: enterpriseAId, nickname: `Adjust customer ${suffix}` },
      ]).returning({ id: users.id });
      createdUserIds.push(referrerA.id, referrerB.id, designerUser.id, designerAltUser.id, measurerUser.id, customerUser.id);
      const staffRepository = new AdminUserRepository(transaction);
      const [designer, designerAlt, measurer] = await Promise.all([
        staffRepository.create({
          enterpriseId: enterpriseAId,
          userId: designerUser.id,
          username: `${testRunKey}-adjust-designer-${suffix}`,
          passwordHash: 'test-hash',
          displayName: 'Adjust Designer',
          role: 'designer',
        }),
        staffRepository.create({
          enterpriseId: enterpriseAId,
          userId: designerAltUser.id,
          username: `${testRunKey}-adjust-designer-alt-${suffix}`,
          passwordHash: 'test-hash',
          displayName: 'Adjust Designer Alt',
          role: 'designer',
        }),
        staffRepository.create({
          enterpriseId: enterpriseAId,
          userId: measurerUser.id,
          username: `${testRunKey}-adjust-measurer-${suffix}`,
          passwordHash: 'test-hash',
          displayName: 'Adjust Measurer',
          role: 'measurer',
        }),
      ]);
      createdStaffIds.push(designer.id, designerAlt.id, measurer.id);
      const [profileA, profileB] = await transaction.insert(referrerProfiles).values([
        { userId: referrerA.id, displayName: 'Adjust Referrer A' },
        { userId: referrerB.id, displayName: 'Adjust Referrer B' },
      ]).returning();
      const [membershipA, membershipB] = await transaction.insert(referrerEnterpriseMemberships).values([
        { referrerId: profileA.id, enterpriseId: enterpriseAId },
        { referrerId: profileB.id, enterpriseId: enterpriseAId },
      ]).returning();
      membershipAId = membershipA.id;
      membershipBId = membershipB.id;

      const commissionRepository = new LeadCommissionRepository(transaction);
      const portal = new ReferrerPortalRepository(transaction);
      await commissionRepository.updateRules(enterpriseAId, designer.id, [
        { role: 'referrer', calculationType: 'fixed', value: '100.0000', status: 'active', version: 1 },
        { role: 'designer', calculationType: 'fixed', value: '50.0000', status: 'active', version: 1 },
        { role: 'measurer', calculationType: 'fixed', value: '20.0000', status: 'active', version: 1 },
      ]);

      const adjustLead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        referrerMembershipId: membershipA.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Adjust payable commission lead',
        phone: `153${String(Date.now()).slice(-8)}`,
        source: 'referrer_network',
        status: 'designing',
      });
      adjustLeadId = adjustLead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: adjustLead.id,
        actorId: designer.id,
        convertedOn: chinaDateString(),
        contractAmount: '1000.00',
        conversionNote: null,
      });
      const adjustRows = await commissionRepository.list(enterpriseAId, { leadId: adjustLead.id });
      const referrerRow = adjustRows.find((item) => item.role === 'referrer');
      const designerRow = adjustRows.find((item) => item.role === 'designer');
      assert.ok(referrerRow && designerRow);
      assert.equal(referrerRow.payableAmount, '100.00');
      assert.equal(referrerRow.originalPayableAmount, '100.00');
      assert.equal(referrerRow.beneficiaryUserId, referrerA.id);
      assert.equal(referrerRow.originalBeneficiaryUserId, referrerA.id);

      const amountAdjusted = await commissionRepository.adjustPayable(enterpriseAId, referrerRow.id, designer.id, {
        payableAmount: '166.50',
        reason: 'contract bonus',
      });
      assert.equal(amountAdjusted.payableAmount, '166.50');
      assert.equal(amountAdjusted.originalPayableAmount, '100.00');
      assert.equal(amountAdjusted.beneficiaryUserId, referrerA.id);
      assert.equal(amountAdjusted.originalBeneficiaryUserId, referrerA.id);
      assert.equal(amountAdjusted.adjustReason, 'contract bonus');
      assert.equal(amountAdjusted.adjustedBy, designer.id);
      assert.ok(amountAdjusted.adjustedAt);

      const amountAdjustedWithoutReason = await commissionRepository.adjustPayable(enterpriseAId, referrerRow.id, designer.id, {
        payableAmount: '170.00',
      });
      assert.equal(amountAdjustedWithoutReason.payableAmount, '170.00');
      assert.equal(amountAdjustedWithoutReason.originalPayableAmount, '100.00');
      assert.equal(amountAdjustedWithoutReason.adjustReason, null);
      assert.equal(amountAdjustedWithoutReason.adjustedBy, designer.id);
      assert.ok(amountAdjustedWithoutReason.adjustedAt);

      const earningsBeforeSwap = await portal.listEarnings(referrerA.id, membershipA.id, enterpriseAId);
      assert.ok(earningsBeforeSwap);
      assert.equal(earningsBeforeSwap.items.some((item) => item.id === referrerRow.id.toString() && item.status === 'payable'), true);
      assert.equal(earningsBeforeSwap.payableCount >= 1, true);
      assert.equal('amount' in (earningsBeforeSwap.items.find((item) => item.id === referrerRow.id.toString()) || {}), false);

      const beneficiaryAdjusted = await commissionRepository.adjustPayable(enterpriseAId, referrerRow.id, designer.id, {
        beneficiaryUserId: referrerB.id,
        reason: 'reassign referrer payout',
      });
      assert.equal(beneficiaryAdjusted.payableAmount, '166.50');
      assert.equal(beneficiaryAdjusted.beneficiaryUserId, referrerB.id);
      assert.equal(beneficiaryAdjusted.originalBeneficiaryUserId, referrerA.id);
      assert.equal(beneficiaryAdjusted.originalPayableAmount, '100.00');
      assert.equal(beneficiaryAdjusted.adjustReason, 'reassign referrer payout');

      const oldEarnings = await portal.listEarnings(referrerA.id, membershipA.id, enterpriseAId);
      const newEarnings = await portal.listEarnings(referrerB.id, membershipB.id, enterpriseAId);
      assert.ok(oldEarnings && newEarnings);
      assert.equal(oldEarnings.items.some((item) => item.id === referrerRow.id.toString()), false);
      assert.equal(newEarnings.items.some((item) => item.id === referrerRow.id.toString() && item.status === 'payable'), true);
      assert.equal('amount' in (newEarnings.items.find((item) => item.id === referrerRow.id.toString()) || {}), false);

      await assert.rejects(
        () => commissionRepository.adjustPayable(enterpriseAId, designerRow.id, designer.id, {
          beneficiaryUserId: measurerUser.id,
          reason: 'wrong role',
        }),
        /不是本企业已绑定的设计师/
      );
      await assert.rejects(
        () => commissionRepository.adjustPayable(enterpriseAId, referrerRow.id, designer.id, {
          beneficiaryUserId: designerUser.id,
          reason: 'staff is not referrer',
        }),
        /不是本企业活动推荐人成员/
      );

      const designerAdjusted = await commissionRepository.adjustPayable(enterpriseAId, designerRow.id, designer.id, {
        payableAmount: '55.25',
        beneficiaryUserId: designerAltUser.id,
        reason: 'designer payout correction',
      });
      assert.equal(designerAdjusted.payableAmount, '55.25');
      assert.equal(designerAdjusted.beneficiaryUserId, designerAltUser.id);
      assert.equal(designerAdjusted.originalPayableAmount, '50.00');
      assert.equal(designerAdjusted.originalBeneficiaryUserId, designerUser.id);

      const paidLead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        referrerMembershipId: membershipA.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Adjust paid reject lead',
        phone: `154${String(Date.now()).slice(-8)}`,
        source: 'referrer_network',
        status: 'designing',
      });
      paidLeadId = paidLead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: paidLead.id,
        actorId: designer.id,
        convertedOn: chinaDateString(),
        contractAmount: '1000.00',
        conversionNote: null,
      });
      const paidRows = await commissionRepository.list(enterpriseAId, { leadId: paidLead.id, role: 'measurer' });
      assert.equal(paidRows.length, 1);
      await commissionRepository.adjustPayable(enterpriseAId, paidRows[0].id, designer.id, {
        payableAmount: '33.00',
        reason: 'pre-pay tweak',
      });
      const [markedPaid] = await commissionRepository.markPaid(enterpriseAId, [paidRows[0].id], designer.id);
      assert.equal(markedPaid.status, 'paid');
      assert.equal(markedPaid.payableAmount, '33.00');
      await assert.rejects(
        () => commissionRepository.adjustPayable(enterpriseAId, paidRows[0].id, designer.id, {
          payableAmount: '1.00',
          reason: 'after paid',
        }),
        /仅待支付提成可调整/
      );

      const voidLead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        customerUserId: customerUser.id,
        referrerMembershipId: membershipA.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        name: 'Adjust void reject lead',
        phone: `155${String(Date.now()).slice(-8)}`,
        source: 'referrer_network',
        status: 'designing',
      });
      voidLeadId = voidLead.id;
      await new LeadLifecycleRepository(transaction).convert({
        leadId: voidLead.id,
        actorId: designer.id,
        convertedOn: chinaDateString(),
        contractAmount: '1000.00',
        conversionNote: null,
      });
      const voidSourceRows = await commissionRepository.list(enterpriseAId, { leadId: voidLead.id, role: 'referrer' });
      assert.equal(voidSourceRows.length, 1);
      await commissionRepository.adjustPayable(enterpriseAId, voidSourceRows[0].id, designer.id, {
        payableAmount: '12.00',
        reason: 'pre-void tweak',
      });
      await new LeadLifecycleRepository(transaction).revertConversion({
        leadId: voidLead.id,
        actorId: designer.id,
        reason: 'void after adjust',
      });
      const voidedRows = await commissionRepository.list(enterpriseAId, { leadId: voidLead.id });
      assert.equal(voidedRows.every((item) => item.status === 'voided' && item.voidReason === 'void after adjust'), true);
      assert.equal(voidedRows.find((item) => item.role === 'referrer')?.payableAmount, '12.00');
      await assert.rejects(
        () => commissionRepository.adjustPayable(enterpriseAId, voidSourceRows[0].id, designer.id, {
          payableAmount: '9.00',
          reason: 'after void',
        }),
        /仅待支付提成可调整/
      );
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      for (const leadId of [adjustLeadId, paidLeadId, voidLeadId]) {
        if (!leadId) continue;
        await transaction.delete(leadCommissions).where(eq(leadCommissions.leadId, leadId));
        await transaction.delete(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadRecordId, leadId));
        await transaction.delete(leads).where(eq(leads.id, leadId));
      }
      for (const membershipId of [membershipAId, membershipBId]) {
        if (membershipId) {
          await transaction.delete(referrerEnterpriseMemberships).where(eq(referrerEnterpriseMemberships.id, membershipId));
        }
      }
      if (createdUserIds.length) {
        await transaction.delete(referrerProfiles).where(inArray(referrerProfiles.userId, createdUserIds));
      }
      await transaction.delete(enterpriseCommissionRules).where(eq(enterpriseCommissionRules.enterpriseId, enterpriseAId));
      if (createdStaffIds.length) await transaction.delete(adminUsers).where(inArray(adminUsers.id, createdStaffIds));
      if (createdUserIds.length) await transaction.delete(users).where(inArray(users.id, createdUserIds));
    });
  }
});

after(async () => {
  if (enterpriseAId && enterpriseBId) {
    await withPlatformTransaction(async (transaction) => {
      if (aiStylePresetId) {
        await transaction
          .delete(aiStylePresets)
          .where(eq(aiStylePresets.id, aiStylePresetId));
      }
      if (aiProviderConfigId) {
        await transaction
          .delete(aiProviderConfigs)
          .where(eq(aiProviderConfigs.id, aiProviderConfigId));
      }
      await transaction
        .delete(aiCreditPrices)
        .where(like(aiCreditPrices.actionKey, `${testRunKey}%`));
      await transaction
        .delete(aiModelCreditPrices)
        .where(like(aiModelCreditPrices.modelProfileKey, `${testRunKey}%`));
      if (aiCreditLedgerIds.length) {
        await transaction
          .delete(aiCreditLedgers)
          .where(inArray(aiCreditLedgers.id, aiCreditLedgerIds));
      }
      if (aiCreditAccountId) {
        await transaction
          .delete(aiCreditAccounts)
          .where(eq(aiCreditAccounts.id, aiCreditAccountId));
      }
      if (promptRevisionId) {
        await transaction
          .delete(aiPromptLibraryRevisions)
          .where(eq(aiPromptLibraryRevisions.id, promptRevisionId));
      }
      await transaction
        .delete(platformConfigs)
        .where(eq(platformConfigs.key, testRunKey));
      await transaction
        .delete(mediaStorageConfigs)
        .where(eq(mediaStorageConfigs.key, testRunKey));
      await transaction
        .delete(systemRoles)
        .where(eq(systemRoles.roleKey, systemRoleKey));
      if (packageIds.length > 0) {
        await transaction.delete(packages).where(inArray(packages.id, packageIds));
      }
      if (promotionRecordIds.length > 0) {
        await transaction
          .delete(promotionEnterpriseRecords)
          .where(inArray(promotionEnterpriseRecords.id, promotionRecordIds));
      }
      if (identityAdminIds.length > 0) {
        await transaction
          .delete(adminUsers)
          .where(inArray(adminUsers.id, identityAdminIds));
      }
      if (identityUserIds.length > 0) {
        await transaction
          .delete(users)
          .where(inArray(users.id, identityUserIds));
      }
      // Ensure tenant media assets don't block enterprise cleanup.
      await transaction
        .delete(mediaAssets)
        .where(inArray(mediaAssets.enterpriseId, [enterpriseAId, enterpriseBId]));
      await transaction
        .delete(enterprises)
        .where(inArray(enterprises.id, [enterpriseAId, enterpriseBId]));
    });
  }
  await closePostgresPool();
});

test('tenant transaction only sees its own rows', async () => {
  const tenantARows = await withTenantTransaction(
    enterpriseAId,
    (transaction) => new DepartmentRepository(transaction).list()
  );
  const tenantBRows = await withTenantTransaction(
    enterpriseBId,
    (transaction) => new DepartmentRepository(transaction).list()
  );

  assert.deepEqual(
    tenantARows.map((row) => row.name),
    ['Tenant A Department']
  );
  assert.deepEqual(
    tenantBRows.map((row) => row.name),
    ['Tenant B Department']
  );
});

test('RLS rejects a cross-tenant insert even without a repository filter', async () => {
  await assert.rejects(
    withTenantTransaction(enterpriseAId, async (transaction) => {
      await new DepartmentRepository(transaction).create({
        enterpriseId: enterpriseBId,
        name: 'Cross-tenant write',
      });
    }),
    (error: unknown) =>
      (error as { cause?: { code?: string } }).cause?.code === '42501'
      || (error as { code?: string }).code === '42501'
  );
});

test('platform transaction sees both tenants', async () => {
  const visibleCount = await withPlatformTransaction(async (transaction) => {
    const rows = await transaction
      .select({ value: count() })
      .from(departments)
      .where(inArray(departments.enterpriseId, [enterpriseAId, enterpriseBId]));
    return rows[0].value;
  });
  assert.equal(visibleCount, 2);
});

test('transaction context does not leak back into the connection pool', async () => {
  await withTenantTransaction(enterpriseAId, async (transaction) => {
    const rows = await transaction
      .select({ value: count() })
      .from(departments);
    assert.equal(rows[0].value, 1);
  });

  const result = await getPostgresPool().query<{ value: string }>(
    'select count(*) as value from app.departments'
  );
  assert.equal(result.rows[0].value, '0');
});

test('failed repository work rolls back atomically', async () => {
  const rollbackCode = `${testRunKey}-rollback`;
  await assert.rejects(
    withPlatformTransaction(async (transaction) => {
      await new EnterpriseRepository(transaction).create({
        name: 'Must Roll Back',
        code: rollbackCode,
      });
      throw new Error('rollback sentinel');
    }),
    /rollback sentinel/
  );

  const rows = await withPlatformTransaction((transaction) =>
    transaction
      .select({ id: enterprises.id })
      .from(enterprises)
      .where(eq(enterprises.code, rollbackCode))
  );
  assert.equal(rows.length, 0);
});

test('prompt repository returns the active revision and related records', async () => {
  const result = await withPlatformTransaction(async (transaction) => {
    const repository = new PromptLibraryRepository(transaction);
    const revision = await repository.findActiveRevision(testRunKey);
    assert.equal(revision?.id, promptRevisionId);

    const categories = await repository.listCategories(promptRevisionId);
    assert.equal(categories.length, 1);

    const templates = await repository.listTemplates(promptRevisionId, {
      page: 1,
      limit: 10,
      query: 'test prompt',
      categorySourceIds: [categories[0].sourceId],
    });
    assert.equal(templates.total, 1);
    assert.equal(templates.rows[0].id, promptTemplateId);

    const template = await repository.findTemplate(
      promptRevisionId,
      promptTemplateId
    );
    assert.equal(template?.previewAssetId, templates.rows[0].previewAssetId);
    const asset = await repository.findTemplateAsset(
      promptRevisionId,
      template?.previewAssetId ?? null
    );
    assert.equal(asset?.storageKey, `${testRunKey}/preview.png`);
    const assets = await repository.listTemplateAssets(
      promptRevisionId,
      asset ? [asset.id] : []
    );
    assert.equal(assets.length, 1);
    return templates.total;
  });
  assert.equal(result, 1);
});

test('platform config upsert preserves unrelated JSON sections', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    await repository.upsert(testRunKey, {
      mediaStorage: { activeProviderKey: 'local' },
      promotionConfig: { protectionPeriodDays: 30 },
    });
    await repository.upsert(testRunKey, {
      promotionConfig: { protectionPeriodDays: 45 },
    });

    const config = await repository.findByKey(testRunKey);
    assert.deepEqual(config?.mediaStorage, { activeProviderKey: 'local' });
    assert.deepEqual(config?.promotionConfig, { protectionPeriodDays: 45 });
  });
});

test('system role defaults are idempotent and preserve configured permissions', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new SystemRoleRepository(transaction);
    await repository.ensureDefaults([
      {
        roleKey: systemRoleKey,
        label: 'Test role',
        menuKeys: ['dashboard'],
      },
    ]);

    const created = await repository.findByRoleKey(systemRoleKey);
    assert.ok(created);
    const updated = await repository.updateMenuKeys(created.id, [
      'dashboard',
      'roles',
    ]);
    assert.deepEqual(updated?.menuKeys, ['dashboard', 'roles']);

    await repository.ensureDefaults([
      {
        roleKey: systemRoleKey,
        label: 'Seed label must not overwrite',
        menuKeys: ['dashboard'],
      },
    ]);

    const preserved = await repository.findByRoleKey(systemRoleKey);
    assert.equal(preserved?.label, 'Test role');
    assert.deepEqual(preserved?.menuKeys, ['dashboard', 'roles']);
  });
});

test('package repository preserves exact money values and global catalog filters', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new PackageRepository(transaction);
    const active = await repository.create({
      name: `${testRunKey} Active Package`,
      price: '1999.90',
      promotionCommission: '88.80',
      description: 'PostgreSQL package integration test',
      features: ['surveying', 'design'],
      status: 'active',
    });
    const disabled = await repository.create({
      name: `${testRunKey} Disabled Package`,
      price: '2999.00',
      promotionCommission: '0.00',
      status: 'disabled',
    });
    packageIds.push(active.id, disabled.id);

    const activeRows = await repository.list('active');
    const created = activeRows.find((row) => row.id === active.id);
    assert.equal(created?.price, '1999.90');
    assert.equal(created?.promotionCommission, '88.80');
    assert.deepEqual(created?.features, ['surveying', 'design']);
    assert.equal(activeRows.some((row) => row.id === disabled.id), false);

    const updated = await repository.update(active.id, {
      status: 'disabled',
      price: '1888.00',
    });
    assert.equal(updated?.status, 'disabled');
    assert.equal(updated?.price, '1888.00');
  });
});

test('package names have a database uniqueness contract', async () => {
  const result = await getPostgresPool().query<{ definition: string }>(`
    select indexdef as definition
    from pg_indexes
    where schemaname = 'app'
      and indexname = 'packages_name_uidx'
  `);
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].definition, /unique index/i);
  assert.match(result.rows[0].definition, /\(name\)/i);
});

test('promotion repository enforces tenant and role visibility with typed relations', async () => {
  const tenantARecords = await withTenantTransaction(
    enterpriseAId,
    async (transaction) => {
      const repository = new PromotionRecordRepository(transaction);
      const own = await repository.create({
        enterpriseId: enterpriseAId,
        promoterId: promotionPromoterAId,
        enterpriseName: `${testRunKey} Promotion A Own`,
        creditCode: `${testRunKey}-CREDIT-A`,
        contactPerson: 'Contact A',
        phone: '13800001001',
        ownershipStatus: 'auto_locked',
        businessStage: 'measuring',
        pendingActionRole: 'measurer',
        poolStatus: 'protected',
        measureTaskStatus: 'assigned',
        measureAssignedTo: promotionMeasurerAId,
        designTaskStatus: 'assigned',
        designAssignedTo: promotionDesignerAId,
      });
      const other = await repository.create({
        enterpriseId: enterpriseAId,
        promoterId: promotionPromoterA2Id,
        enterpriseName: `${testRunKey} Promotion A Other`,
        contactPerson: 'Contact B',
        phone: '13800001002',
        ownershipStatus: 'auto_locked',
        businessStage: 'reported',
        pendingActionRole: 'salesperson',
        poolStatus: 'in_pool',
      });
      promotionRecordIds.push(own.id, other.id);
      return { own, other };
    }
  );

  const tenantBRecord = await withTenantTransaction(
    enterpriseBId,
    async (transaction) => {
      const created = await new PromotionRecordRepository(transaction).create({
        enterpriseId: enterpriseBId,
        promoterId: promotionPromoterBId,
        enterpriseName: `${testRunKey} Promotion B`,
        contactPerson: 'Contact C',
        phone: '13800001003',
        ownershipStatus: 'auto_locked',
        businessStage: 'reported',
        pendingActionRole: 'salesperson',
        poolStatus: 'protected',
      });
      promotionRecordIds.push(created.id);
      return created;
    }
  );

  const salespersonRows = await withTenantTransaction(
    enterpriseAId,
    (transaction) =>
      new PromotionRecordRepository(transaction).list({
        actor: { id: promotionPromoterAId, role: 'salesperson' },
      })
  );
  assert.deepEqual(
    salespersonRows.rows.map((row) => row.id),
    [tenantARecords.own.id]
  );
  assert.equal(
    salespersonRows.rows[0].measureAssignee?.id,
    promotionMeasurerAId
  );
  assert.equal(
    salespersonRows.rows[0].designAssignee?.id,
    promotionDesignerAId
  );
  assert.equal(salespersonRows.rows[0].enterprise?.id, enterpriseAId);

  const measurerRows = await withTenantTransaction(
    enterpriseAId,
    (transaction) =>
      new PromotionRecordRepository(transaction).list({
        actor: { id: promotionMeasurerAId, role: 'measurer' },
      })
  );
  assert.deepEqual(
    measurerRows.rows.map((row) => row.id),
    [tenantARecords.own.id]
  );

  const crossTenant = await withTenantTransaction(
    enterpriseBId,
    (transaction) =>
      new PromotionRecordRepository(transaction).findById(tenantARecords.own.id)
  );
  assert.equal(crossTenant, null);

  const platformRows = await withPlatformTransaction((transaction) =>
    new PromotionRecordRepository(transaction).list({ search: testRunKey })
  );
  assert.equal(platformRows.total, 3);
  assert.ok(platformRows.rows.some((row) => row.id === tenantBRecord.id));

  const duplicates = await withTenantTransaction(
    enterpriseAId,
    (transaction) =>
      new PromotionRecordRepository(transaction).findDuplicates({
        creditCode: `${testRunKey}-credit-a`,
        enterpriseName: 'No name match needed',
        phone: '000',
      })
  );
  assert.deepEqual(duplicates.map((row) => row.id), [tenantARecords.own.id]);
});

test('an unbound platform salesperson uses an actor-scoped promotion transaction', async () => {
  const result = await withPromotionPostgresTransaction(
    {
      userId: promotionPromoterAId.toString(),
      username: 'platform-salesperson',
      role: 'salesperson',
      enterpriseId: null,
    },
    (transaction) =>
      new PromotionRecordRepository(transaction).list({
        actor: { id: promotionPromoterAId, role: 'salesperson' },
      })
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].promoterId, promotionPromoterAId);
});

test('promotion state transition and notification dedupe are atomic', async () => {
  await withTenantTransaction(enterpriseAId, async (transaction) => {
    const records = new PromotionRecordRepository(transaction);
    const poolRows = await records.list({
      promoterId: promotionPromoterA2Id,
      poolStatuses: ['in_pool'],
    });
    const poolRecord = poolRows.rows[0];
    assert.ok(poolRecord);

    const claimedAt = new Date();
    const claimed = await records.updateWhere(
      poolRecord.id,
      [eq(promotionEnterpriseRecords.poolStatus, 'in_pool')],
      {
        promoterId: promotionPromoterAId,
        poolStatus: 'claimed',
        claimStatus: 'pending',
        claimRequestedBy: promotionPromoterAId,
        claimRequestedAt: claimedAt,
        lastActivityAt: claimedAt,
      },
      [
        {
          type: 'pool_claim_requested',
          content: 'Claim requested',
          operator: 'Promotion A 1',
          createdAt: claimedAt,
        },
      ]
    );
    assert.equal(claimed?.claimStatus, 'pending');
    assert.equal(claimed?.followUpRecords.length, 1);

    const staleClaim = await records.updateWhere(
      poolRecord.id,
      [eq(promotionEnterpriseRecords.poolStatus, 'in_pool')],
      { poolStatus: 'claimed' }
    );
    assert.equal(staleClaim, null);

    const notifications = new WorkflowNotificationRepository(transaction);
    const common = {
      enterpriseId: enterpriseAId,
      recordId: poolRecord.id,
      recipientStaffId: promotionPromoterAId,
      recipientRole: 'salesperson',
      notificationType: 'follow_up_created',
      status: 'sent',
      dedupeKey: `${testRunKey}-notification`,
      message: 'Follow up required',
    } as const;
    const station = await notifications.create({ ...common, channel: 'station' });
    const miniProgram = await notifications.create({
      ...common,
      channel: 'miniprogram_sub',
    });
    const duplicate = await notifications.create({ ...common, channel: 'station' });
    assert.ok(station);
    assert.ok(miniProgram);
    assert.equal(duplicate, null);

    const listed = await notifications.list({
      recipientStaffId: promotionPromoterAId,
      status: 'sent',
    });
    assert.equal(listed.total, 2);
    assert.equal(listed.statusCounts.sent, 2);
    assert.equal(listed.rows[0].record?.id, poolRecord.id);
    assert.equal(listed.rows[0].recipientStaff?.id, promotionPromoterAId);
    assert.ok(listed.rows[0].recipientStaff?.username);
    assert.notEqual(listed.rows[0].recipientStaff?.phone, undefined);

    const marked = await notifications.markAlerted(
      [station.id, miniProgram.id],
      promotionPromoterAId
    );
    assert.equal(marked, 2);
    const alertedRows = await transaction
      .select()
      .from(workflowNotificationLogs)
      .where(inArray(workflowNotificationLogs.id, [station.id, miniProgram.id]));
    assert.equal(alertedRows.every((row) => row.isAlerted), true);
  });
});

test('postgres promotion workflow creates follow-up state and workbench todos', async () => {
  const actor = promotionActorFromContext({
    id: promotionPromoterAId,
    role: 'salesperson',
    name: 'Promotion A 1',
    enterpriseId: enterpriseAId,
  });
  const created = await withTenantTransaction(enterpriseAId, (transaction) =>
    createPromotionRecord(transaction, {
      enterpriseName: `${testRunKey} Workflow Service`,
      contactPerson: 'Workflow Contact',
      phone: '13800001009',
      notes: 'Created by the PostgreSQL workflow service',
    }, actor)
  );
  assert.ok(created.record);
  assert.equal(created.created, true);
  promotionRecordIds.push(created.record.id);
  assert.equal(created.record.businessStage, 'reported');
  assert.equal(created.record.pendingActionRole, 'salesperson');

  const updated = await withTenantTransaction(enterpriseAId, (transaction) =>
    updatePromotionRecord(transaction, created.record!.id, {
      followUpNote: 'First customer contact completed',
    }, actor)
  );
  assert.ok(updated?.record);
  assert.equal(updated.record.businessStage, 'contacted');
  assert.equal(updated.record.followUpRecords.length, 3);

  const todos = await listWorkbenchTodos({
    role: 'salesperson',
    userId: promotionPromoterAId.toString(),
    enterpriseId: enterpriseAId.toString(),
    view: 'mine',
  });
  assert.ok(todos.some((todo) => todo.recordId === created.record!.id.toString()));
});

test('admin user repository preserves tenant isolation and promoter relations', async () => {
  const created = await withTenantTransaction(
    enterpriseAId,
    async (transaction) => {
      const repository = new AdminUserRepository(transaction);
      const promoter = await repository.create({
        enterpriseId: enterpriseAId,
        username: `${testRunKey}-promoter`,
        passwordHash: 'test-hash',
        displayName: 'Promoter',
        role: 'salesperson',
        phone: null,
        menuPermissions: ['dashboard'],
      });
      const designer = await repository.create(
        {
          enterpriseId: enterpriseAId,
          username: `${testRunKey}-designer`,
          passwordHash: 'test-hash',
          displayName: 'Designer',
          role: 'designer',
          phone: null,
          menuPermissions: ['dashboard', 'ai-scenarios'],
        },
        [promoter.id]
      );
      identityAdminIds.push(promoter.id, designer.id);
      return { promoter, designer };
    }
  );

  const tenantAList = await withTenantTransaction(
    enterpriseAId,
    (transaction) =>
      new AdminUserRepository(transaction).list({
        search: testRunKey,
        page: 1,
        limit: 10,
      })
  );
  const designer = tenantAList.rows.find(
    (row) => row.id === created.designer.id
  );
  assert.deepEqual(designer?.promoterIds, [created.promoter.id]);

  const crossTenant = await withTenantTransaction(
    enterpriseBId,
    (transaction) =>
      new AdminUserRepository(transaction).findById(created.designer.id)
  );
  assert.equal(crossTenant, null);
});

test('user repository resolves and updates Mini Program identities', async () => {
  const openid = `${testRunKey}-openid`;
  const created = await withTenantTransaction(
    enterpriseAId,
    (transaction) =>
      new UserRepository(transaction).create({
        enterpriseId: enterpriseAId,
        openid,
        role: 'staff',
        nickname: 'Before',
      })
  );
  identityUserIds.push(created.id);

  const updated = await withPlatformTransaction(async (transaction) => {
    const repository = new UserRepository(transaction);
    const found = await repository.findByOpenid(openid);
    assert.equal(found?.id, created.id);
    const identityRows = await transaction
      .select({
        legacyOpenid: users.openid,
        identityOpenid: wechatIdentities.openid,
      })
      .from(users)
      .leftJoin(
        wechatIdentities,
        eq(wechatIdentities.userId, users.id)
      )
      .where(eq(users.id, created.id));
    assert.equal(identityRows[0]?.legacyOpenid, null);
    assert.equal(identityRows[0]?.identityOpenid, openid);
    return repository.update(created.id, {
      nickname: 'After',
      phone: '13800000000',
    });
  });
  assert.equal(updated?.nickname, 'After');
  assert.equal(updated?.phone, '13800000000');

  const crossTenant = await withTenantTransaction(
    enterpriseBId,
    (transaction) => new UserRepository(transaction).findById(created.id)
  );
  assert.equal(crossTenant, null);
});

test('media storage repository uses optimistic test-result updates', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new MediaStorageConfigRepository(transaction);
    const created = await repository.create({
      key: testRunKey,
      name: 'Test storage',
      driver: 'qiniu',
      accessKeyEncrypted: 'encrypted-ak',
      accessKeyMasked: 'ak***',
      secretKeyEncrypted: 'encrypted-sk',
      secretKeyMasked: 'sk***',
      bucket: 'private-bucket',
      region: 'z0',
      domain: 'https://media.example.test',
      lastTestMessage: 'not tested',
    });
    const updated = await repository.update(created.id, {
      name: 'Renamed storage',
    });
    assert.ok(updated);

    const staleResult = await repository.recordTestResult(
      created.id,
      created.updatedAt,
      {
        lastTestedAt: new Date(),
        lastTestOk: true,
        lastTestMessage: 'stale success',
      }
    );
    assert.equal(staleResult, null);

    const currentResult = await repository.recordTestResult(
      created.id,
      updated.updatedAt,
      {
        lastTestedAt: new Date(),
        lastTestOk: true,
        lastTestMessage: 'current success',
      }
    );
    assert.equal(currentResult?.lastTestOk, true);
    assert.equal(currentResult?.lastTestMessage, 'current success');
  });
});

test('Mini Program identity contexts are database-backed and tenant-safe', async () => {
  let userId: bigint | null = null;
  let staffId: bigint | null = null;
  let referrerId: bigint | null = null;
  let membershipId: bigint | null = null;
  const openid = `${testRunKey}-context-openid`;
  const phone = `131${String(Date.now()).slice(-8)}`;
  try {
    const created = await withPlatformTransaction(async (transaction) => {
      const usersRepository = new UserRepository(transaction);
      const user = await usersRepository.create({
        phone,
        nickname: 'Identity context user',
      });
      const identities = new MiniProgramIdentityRepository(transaction);
      await identities.attachWechatIdentity({ userId: user.id, openid });
      const staff = await new AdminUserRepository(transaction).create({
        enterpriseId: enterpriseAId,
        username: `${testRunKey}-context-staff`,
        passwordHash: 'test-hash',
        displayName: 'Identity Staff',
        role: 'designer',
        phone,
      });
      await identities.resolveWechatPhoneUser({ openid, phone });
      const [referrer] = await transaction
        .insert(referrerProfiles)
        .values({ userId: user.id, displayName: 'Identity Referrer' })
        .returning();
      const [membership] = await transaction
        .insert(referrerEnterpriseMemberships)
        .values({
          referrerId: referrer.id,
          enterpriseId: enterpriseAId,
        })
        .returning();
      return { user, staff, referrer, membership };
    });
    userId = created.user.id;
    staffId = created.staff.id;
    referrerId = created.referrer.id;
    membershipId = created.membership.id;

    await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const contexts = await identities.listContexts(created.user.id);
      assert.deepEqual(
        contexts.map((context) => context.mode),
        ['customer', 'staff', 'referrer']
      );
      assert.equal(contexts[1].staffId, created.staff.id);
      assert.equal(
        contexts[2].referrerMembershipId,
        created.membership.id
      );
      assert.equal(
        await identities.selectContext(created.user.id, {
          mode: 'referrer',
          enterpriseId: enterpriseBId,
          referrerMembershipId: created.membership.id,
        }),
        null
      );
      assert.equal(
        await identities.bumpContextVersion(created.user.id),
        created.user.contextVersion + 1
      );
      await assert.rejects(
        identities.attachWechatIdentity({
          userId: created.user.id,
          openid: `${openid}-replacement`,
        }),
        /WECHAT_USER_ALREADY_LINKED/
      );
    });

    await assert.rejects(
      withTenantTransaction(enterpriseBId, async (transaction) => {
        await transaction.insert(referrerEnterpriseMemberships).values({
          referrerId: created.referrer.id,
          enterpriseId: enterpriseAId,
        });
      }),
      (error: unknown) =>
        (error as { cause?: { code?: string } }).cause?.code === '42501' ||
        (error as { code?: string }).code === '42501'
    );
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (membershipId) {
        await transaction
          .delete(referrerEnterpriseMemberships)
          .where(eq(referrerEnterpriseMemberships.id, membershipId));
      }
      if (referrerId) {
        await transaction
          .delete(referrerProfiles)
          .where(eq(referrerProfiles.id, referrerId));
      }
      if (staffId) {
        await transaction
          .delete(adminUsers)
          .where(eq(adminUsers.id, staffId));
      }
      if (userId) {
        await transaction
          .delete(wechatIdentities)
          .where(eq(wechatIdentities.userId, userId));
        await transaction.delete(users).where(eq(users.id, userId));
      }
    });
  }
});

test('media asset storage stats use PostgreSQL soft-delete and purge state', async () => {
  const providerKey = `stats-${process.pid}-${Date.now()}`;
  const storageKeys = ['active', 'pending', 'purged'].map(
    (suffix) => `${testRunKey}/${providerKey}/${suffix}.bin`
  );
  try {
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const repository = new AiCreationRepository(transaction);
      await repository.createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'stats-test',
        mimeType: 'application/octet-stream',
        size: 10n,
        storageProvider: providerKey,
        storageKey: storageKeys[0],
      });
      await repository.createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'stats-test',
        mimeType: 'application/octet-stream',
        size: 20n,
        storageProvider: providerKey,
        storageKey: storageKeys[1],
        deletedAt: new Date(),
      });
      await repository.createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'stats-test',
        mimeType: 'application/octet-stream',
        size: 30n,
        storageProvider: providerKey,
        storageKey: storageKeys[2],
        deletedAt: new Date(),
        purgedAt: new Date(),
      });
    });
    const stats = await withPlatformTransaction((transaction) =>
      new MediaAssetRepository(transaction).listStorageStats()
    );
    const providerStats = stats.find((item) => item.storageProvider === providerKey);
    assert.deepEqual(providerStats, {
      storageProvider: providerKey,
      activeCount: '1',
      activeBytes: '10',
      pendingPurgeCount: '1',
      pendingPurgeBytes: '20',
      totalCount: '3',
      totalBytes: '60',
    });
  } finally {
    await withPlatformTransaction((transaction) =>
      transaction.delete(mediaAssets).where(inArray(mediaAssets.storageKey, storageKeys))
    );
  }
});

test('creation model profiles use PostgreSQL catalog records and preserve explicit runtime settings', async () => {
  const key = `${testRunKey}-creation-model`;
  let profileId: bigint | null = null;
  try {
    await withPlatformTransaction(async (transaction) => {
      const repository = new AiCreationModelProfileRepository(transaction);
      await repository.ensureCatalogProfiles([
        {
          key,
          name: 'Integration catalog model',
          description: 'Initial catalog definition',
          sourceModelSourceIds: ['source-a'],
          sourceType: 'grs_catalog',
          adapterType: 'grs',
          remoteModel: 'integration-model',
          family: 'gpt-image-2',
          catalogVersion: 'integration-v1',
          generateLogicalModelKey: 'image.generate.standard',
          editLogicalModelKey: 'image.edit.standard',
          capabilities: {
            supportsReferenceImages: true,
            maxReferenceImages: 4,
            aspectRatios: ['1:1'],
            resolutionTiers: ['1K'],
            supportsCustomSize: false,
          },
          defaults: {
            aspectRatio: '1:1',
            size: '1K',
            quality: '',
            resolutionTier: '1K',
          },
          enabled: true,
          isDefault: false,
          weight: 1,
        },
      ]);
      const created = await repository.findByKey(key);
      assert.ok(created);
      profileId = created.id;
      aiCreationModelProfileIds.push(created.id);
      assert.equal(created.capabilities.maxReferenceImages, 4);

      await repository.update(created.id, { enabled: false });
      await repository.ensureCatalogProfiles([
        {
          key,
          name: 'Integration catalog model v2',
          description: 'Updated catalog definition',
          sourceModelSourceIds: ['source-a', 'source-b'],
          sourceType: 'grs_catalog',
          adapterType: 'grs',
          remoteModel: 'integration-model',
          family: 'gpt-image-2',
          catalogVersion: 'integration-v2',
          generateLogicalModelKey: 'image.generate.standard',
          editLogicalModelKey: 'image.edit.standard',
          capabilities: {
            supportsReferenceImages: true,
            maxReferenceImages: 6,
            aspectRatios: ['1:1', '16:9'],
            resolutionTiers: ['1K', '2K'],
            supportsCustomSize: false,
          },
          defaults: {
            aspectRatio: '1:1',
            size: '1K',
            quality: '',
            resolutionTier: '1K',
          },
          enabled: true,
          isDefault: false,
          weight: 2,
        },
      ]);
      const updated = await repository.findById(created.id);
      assert.equal(updated?.name, 'Integration catalog model v2');
      assert.equal(updated?.catalogVersion, 'integration-v2');
      assert.equal(updated?.enabled, false);
      assert.deepEqual(updated?.capabilities.resolutionTiers, ['1K', '2K']);
      assert.equal(await repository.findEnabledCatalogProfile(created.id), null);
    });

    const outsideCatalog = await withPlatformTransaction((transaction) =>
      new AiCreationModelProfileRepository(transaction).list({
        sourceType: 'grs_catalog',
        enabledOnly: true,
      })
    );
    assert.equal(outsideCatalog.some((profile) => profile.id === profileId), false);
  } finally {
    if (profileId) {
      await withPlatformTransaction((transaction) =>
        transaction
          .delete(aiCreationModelProfiles)
          .where(eq(aiCreationModelProfiles.id, profileId!))
      );
      const index = aiCreationModelProfileIds.indexOf(profileId);
      if (index >= 0) aiCreationModelProfileIds.splice(index, 1);
    }
  }
});

test('PostgreSQL GRS catalog initialization exposes an executable default model', async () => {
  const profiles = await listPostgresExecutableImageModelProfiles();
  const defaultProfile = profiles.find((profile) => profile.key === 'grs-gpt-image-2');
  assert.ok(defaultProfile);
  assert.equal(defaultProfile?.enabled, true);
  assert.equal(defaultProfile?.isDefault, true);
  assert.equal(defaultProfile?.remoteModel, 'gpt-image-2');
});

test('enabling a model credit price reconciles a disabled GRS catalog profile into workbench models', async () => {
  const extraKey = 'grs-nano-banana-2';
  const originalProfiles = await withPlatformTransaction((transaction) =>
    new AiCreationModelProfileRepository(transaction).list({ sourceType: 'grs_catalog' })
  );
  const originalPrices = await withPlatformTransaction((transaction) =>
    new AiModelCreditPriceRepository(transaction).list({ actionKey: 'image.free_create' })
  );
  const extra = originalProfiles.find((profile) => profile.key === extraKey);
  assert.ok(extra, 'GRS catalog should include nano-banana-2');

  try {
    await withPlatformTransaction(async (transaction) => {
      const profiles = new AiCreationModelProfileRepository(transaction);
      const prices = new AiModelCreditPriceRepository(transaction);
      await profiles.updateCatalogSettings({
        id: extra!.id,
        enabled: false,
        isDefault: false,
        maxReferenceImages: Number(extra!.capabilities?.maxReferenceImages || 0),
      });
      for (const price of originalPrices.filter((item) => item.modelProfileKey === extraKey)) {
        await prices.update(extraKey, price.resolutionTier, {
          credits: price.credits,
          enabled: price.resolutionTier === '1K',
          updatedBy: price.updatedBy,
        });
      }
    });

    const executable = await listPostgresExecutableImageModelProfiles();
    const reconciled = executable.find((profile) => profile.key === extraKey);
    assert.ok(reconciled);
    assert.equal(reconciled?.enabled, true);
    assert.equal(reconciled?.remoteModel, 'nano-banana-2');

    const models = await listPostgresWorkbenchImageModels();
    assert.ok(models.length >= 2);
    assert.ok(models.some((model) => model.remoteModel === 'nano-banana-2' && model.prices.some((price) => price.enabled)));
    const defaultModel = models.find((model) => model.isDefault);
    assert.ok(defaultModel);
    assert.equal(models[0]?.id, defaultModel.id);
  } finally {
    await withPlatformTransaction(async (transaction) => {
      const profiles = new AiCreationModelProfileRepository(transaction);
      const prices = new AiModelCreditPriceRepository(transaction);
      await profiles.clearCatalogDefaults();
      for (const profile of originalProfiles) {
        await profiles.updateCatalogSettings({
          id: profile.id,
          enabled: profile.enabled,
          isDefault: profile.isDefault,
          maxReferenceImages: Number(profile.capabilities?.maxReferenceImages || 0),
        });
      }
      for (const price of originalPrices) {
        await prices.update(price.modelProfileKey, price.resolutionTier, {
          credits: price.credits,
          enabled: price.enabled,
          updatedBy: price.updatedBy,
        });
      }
    });
  }
});

test('enabling a GRS catalog model without prices turns on its default resolution price', async () => {
  const extraKey = 'grs-nano-banana-2';
  const originalProfiles = await withPlatformTransaction((transaction) =>
    new AiCreationModelProfileRepository(transaction).list({ sourceType: 'grs_catalog' })
  );
  const originalPrices = await withPlatformTransaction((transaction) =>
    new AiModelCreditPriceRepository(transaction).list({ actionKey: 'image.free_create' })
  );
  const extra = originalProfiles.find((profile) => profile.key === extraKey);
  assert.ok(extra, 'GRS catalog should include nano-banana-2');

  try {
    await withPlatformTransaction(async (transaction) => {
      const profiles = new AiCreationModelProfileRepository(transaction);
      const prices = new AiModelCreditPriceRepository(transaction);
      for (const price of originalPrices.filter((item) => item.modelProfileKey === extraKey)) {
        await prices.update(extraKey, price.resolutionTier, {
          credits: price.credits,
          enabled: false,
          updatedBy: price.updatedBy,
        });
      }
      const enabled = await profiles.updateCatalogSettings({
        id: extra!.id,
        enabled: true,
        isDefault: false,
        maxReferenceImages: Number(extra!.capabilities?.maxReferenceImages || 0),
      });
      assert.ok(enabled);
      await enableDefaultResolutionPriceForProfile(transaction, enabled, { defaultCredits: 10 });
    });

    const executable = await listPostgresExecutableImageModelProfiles();
    assert.ok(executable.some((profile) => profile.key === extraKey));
    const enabledPrices = await withPlatformTransaction((transaction) =>
      new AiModelCreditPriceRepository(transaction).list({
        actionKey: 'image.free_create',
        enabledOnly: true,
      })
    );
    assert.ok(enabledPrices.some((price) => price.modelProfileKey === extraKey && price.resolutionTier === '1K'));
  } finally {
    await withPlatformTransaction(async (transaction) => {
      const profiles = new AiCreationModelProfileRepository(transaction);
      const prices = new AiModelCreditPriceRepository(transaction);
      await profiles.clearCatalogDefaults();
      for (const profile of originalProfiles) {
        await profiles.updateCatalogSettings({
          id: profile.id,
          enabled: profile.enabled,
          isDefault: profile.isDefault,
          maxReferenceImages: Number(profile.capabilities?.maxReferenceImages || 0),
        });
      }
      for (const price of originalPrices) {
        await prices.update(price.modelProfileKey, price.resolutionTier, {
          credits: price.credits,
          enabled: price.enabled,
          updatedBy: price.updatedBy,
        });
      }
    });
  }
});

test('PostgreSQL GRS catalog settings preserve one default and reference-image limits', async () => {
  const originalProfiles = await withPlatformTransaction((transaction) =>
    new AiCreationModelProfileRepository(transaction).list({ sourceType: 'grs_catalog' })
  );
  assert.ok(originalProfiles.length >= 2);
  const first = originalProfiles[0];
  const second = originalProfiles[1];

  try {
    await withPlatformTransaction(async (transaction) => {
      const profiles = new AiCreationModelProfileRepository(transaction);
      await profiles.clearCatalogDefaults();
      await profiles.updateCatalogSettings({
        id: first.id,
        enabled: false,
        isDefault: false,
        maxReferenceImages: 0,
      });
      await profiles.updateCatalogSettings({
        id: second.id,
        enabled: true,
        isDefault: true,
        maxReferenceImages: 4,
      });
    });

    const updated = await withPlatformTransaction((transaction) =>
      new AiCreationModelProfileRepository(transaction).list({ sourceType: 'grs_catalog' })
    );
    const updatedFirst = updated.find((profile) => profile.id === first.id);
    const updatedSecond = updated.find((profile) => profile.id === second.id);
    assert.equal(updatedFirst?.enabled, false);
    assert.equal(updatedFirst?.isDefault, false);
    assert.equal(updatedFirst?.capabilities?.maxReferenceImages, 0);
    assert.equal(updatedFirst?.capabilities?.supportsReferenceImages, false);
    assert.equal(updatedSecond?.enabled, true);
    assert.equal(updatedSecond?.isDefault, true);
    assert.equal(updatedSecond?.capabilities?.maxReferenceImages, 4);
    assert.equal(updatedSecond?.capabilities?.supportsReferenceImages, true);
  } finally {
    await withPlatformTransaction(async (transaction) => {
      const profiles = new AiCreationModelProfileRepository(transaction);
      await profiles.clearCatalogDefaults();
      for (const profile of originalProfiles) {
        await profiles.updateCatalogSettings({
          id: profile.id,
          enabled: profile.enabled,
          isDefault: profile.isDefault,
          maxReferenceImages: Number(profile.capabilities?.maxReferenceImages || 0),
        });
      }
    });
  }
});

test('PostgreSQL creation preparation binds bigint tasks, assets, batches, and generations', async () => {
  let assetId: bigint | null = null;
  let resultAssetId: bigint | null = null;
  let taskId: bigint | null = null;
  try {
    const profiles = await listPostgresExecutableImageModelProfiles();
    const profile = profiles.find((item) => item.key === 'grs-gpt-image-2');
    assert.ok(profile);
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const asset = await new AiCreationRepository(transaction).createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'manual_upload',
        mimeType: 'image/png',
        size: BigInt(4),
        width: 1,
        height: 1,
        storageProvider: 'local',
        storageKey: `${testRunKey}/postgres-creation-preparation.png`,
      });
      assetId = asset.id;
    });
    const task = await createPostgresCreationTask({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      modelProfileId: profile!.id.toString(),
      title: 'PostgreSQL creation preparation',
      prompt: 'Prepare a PostgreSQL creation task',
      referenceAssetIds: [assetId!.toString()],
    });
    taskId = task.id;
    const prepared = await preparePostgresCreationBatch({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      taskId: task.id.toString(),
      modelProfileId: profile!.id.toString(),
      prompt: 'Prepare a PostgreSQL creation batch',
      referenceAssetIds: [assetId!.toString()],
      parameters: { aspectRatio: '1:1', resolutionTier: '1K' },
      count: 3,
    });
    assert.equal(prepared.batch.requestedCount, 3);
    assert.equal(prepared.batch.creditsEstimate > BigInt(0), true);
    assert.equal(prepared.generations.length, 3);

    const view = await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).loadTaskView(task.id)
    );
    assert.equal(view?.batches.length, 1);
    assert.equal(view?.batches[0]?.generations.length, 3);
    assert.equal(view?.batches[0]?.referenceAssetIds[0], assetId);

    const crossTenant = await withTenantTransaction(enterpriseBId, (transaction) =>
      new AiCreationRepository(transaction).findTask(task.id)
    );
    assert.equal(crossTenant, null);
    await assert.rejects(
      refreshPostgresCreationBatchStatus({
        enterpriseId: enterpriseBId.toString(),
        batchId: prepared.batch.id.toString(),
      }),
      /创作批次不存在/
    );

    const creditGrant = await grantAiCredits({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      amount: Number(prepared.batch.creditsEstimate),
      operationId: `${testRunKey}:postgres-creation-hold-grant`,
    });
    aiCreditLedgerIds.push(creditGrant.ledger.id);
    const firstHeld = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
    });
    assert.ok(firstHeld.ledger);
    aiCreditLedgerIds.push(firstHeld.ledger.id);
    assert.equal(firstHeld.generation.status, 'created');
    assert.equal((firstHeld.generation.billing as { status?: string }).status, 'held');
    assert.equal(firstHeld.account.frozenBalance, BigInt(String(prepared.generations[0]!.billing?.price)));

    const providerAttempt = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'integration-provider',
      adapterType: 'grs',
      remoteModel: 'gpt-image-2',
      requestSnapshot: { prompt: 'Prepare a PostgreSQL creation batch', aspectRatio: '1:1' },
    });
    assert.equal(providerAttempt.reused, false);
    assert.equal(providerAttempt.generation.status, 'processing');
    assert.equal(providerAttempt.attempt.generationId, prepared.generations[0]!.id);
    assert.equal(providerAttempt.attempt.status, 'created');

    const acknowledgedAttempt = await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      remoteStatus: 'queued',
      nextPollAfterMs: 2_500,
    });
    assert.equal(acknowledgedAttempt.reused, false);
    assert.equal(acknowledgedAttempt.attempt.accepted, true);
    assert.equal(acknowledgedAttempt.attempt.remoteTaskId, `${testRunKey}-remote-task`);
    assert.equal(acknowledgedAttempt.attempt.status, 'processing');
    assert.equal(
      (acknowledgedAttempt.generation.externalTask as { remoteTaskId?: string }).remoteTaskId,
      `${testRunKey}-remote-task`
    );

    const repeatedAcknowledgement = await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      remoteStatus: 'ignored-on-retry',
    });
    assert.equal(repeatedAcknowledgement.reused, true);
    assert.equal(repeatedAcknowledgement.attempt.remoteStatus, 'queued');

    const unknownPoll = await recordPostgresCreationProviderPollState({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      status: 'unknown',
      remoteStatus: 'upstream-timeout',
      errorMessage: 'Provider did not return a status yet',
    });
    assert.equal(unknownPoll.attempt.status, 'unknown');
    assert.equal(unknownPoll.attempt.errorCode, 'PROVIDER_STATUS_UNKNOWN');
    assert.equal(unknownPoll.generation.status, 'processing');
    assert.equal((unknownPoll.generation.externalTask as { status?: string }).status, 'unknown');

    const processingPoll = await recordPostgresCreationProviderPollState({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      status: 'processing',
      remoteStatus: 'running',
    });
    assert.equal(processingPoll.attempt.status, 'processing');
    assert.equal(processingPoll.attempt.errorCode, null);
    assert.equal((processingPoll.generation.externalTask as { remoteStatus?: string }).remoteStatus, 'running');

    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const creation = new AiCreationRepository(transaction);
      const generation = await creation.findGeneration(prepared.generations[0]!.id);
      assert.ok(generation);
      const scheduled = await creation.updateGeneration(generation.id, {
        externalTask: {
          ...(generation.externalTask as Record<string, unknown>),
          nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        },
      });
      assert.ok(scheduled);
    });

    const [pollClaim] = await claimPostgresCreationProviderPolls({
      enterpriseId: enterpriseAId.toString(),
      limit: 1,
      leaseMs: 30_000,
    });
    assert.ok(pollClaim);
    assert.equal(pollClaim.generationId, prepared.generations[0]!.id.toString());
    assert.equal(pollClaim.attemptId, providerAttempt.attempt.id.toString());
    assert.equal(pollClaim.remoteTaskId, `${testRunKey}-remote-task`);
    assert.ok(pollClaim.pollLeaseId);
    assert.ok(Date.parse(pollClaim.leaseExpiresAt) > Date.now());
    assert.deepEqual(
      await claimPostgresCreationProviderPolls({
        enterpriseId: enterpriseAId.toString(),
        limit: 1,
        leaseMs: 30_000,
      }),
      []
    );
    await assert.rejects(
      recordPostgresCreationProviderPollState({
        enterpriseId: enterpriseAId.toString(),
        generationId: prepared.generations[0]!.id.toString(),
        attemptId: providerAttempt.attempt.id.toString(),
        remoteTaskId: `${testRunKey}-remote-task`,
        status: 'processing',
        pollLeaseId: 'stale-poll-lease',
      }),
      /供应商轮询租约已失效/
    );
    const leasedProcessingPoll = await recordPostgresCreationProviderPollState({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      status: 'processing',
      remoteStatus: 'running-after-lease',
      pollLeaseId: pollClaim.pollLeaseId,
    });
    assert.equal(
      (leasedProcessingPoll.generation.externalTask as { pollLeaseId?: string }).pollLeaseId,
      undefined
    );

    const repeatedProviderAttempt = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'integration-provider',
      adapterType: 'grs',
      remoteModel: 'gpt-image-2',
      requestSnapshot: { prompt: 'ignored on retry' },
    });
    assert.equal(repeatedProviderAttempt.reused, true);
    assert.equal(repeatedProviderAttempt.attempt.id, providerAttempt.attempt.id);

    const completedAttempt = await completePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      remoteStatus: 'completed',
      output: { imageUrl: 'https://provider.example/result.png' },
      actualCost: { currency: 'USD', amountMicros: 1200 },
    });
    assert.equal(completedAttempt.reused, false);
    assert.equal(completedAttempt.generation.status, 'succeeded');
    assert.equal(completedAttempt.attempt.status, 'succeeded');
    assert.equal(
      (completedAttempt.generation.output as { providerResult?: { imageUrl?: string } }).providerResult?.imageUrl,
      'https://provider.example/result.png'
    );

    const repeatedCompletion = await completePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      remoteStatus: 'ignored-on-retry',
    });
    assert.equal(repeatedCompletion.reused, true);
    assert.equal(repeatedCompletion.attempt.remoteStatus, 'completed');

    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const resultAsset = await new AiCreationRepository(transaction).createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'ai_generation_output',
        ownerId: null,
        mimeType: 'image/png',
        size: BigInt(4),
        width: 1,
        height: 1,
        storageProvider: 'local',
        storageKey: `${testRunKey}/postgres-creation-result.png`,
        originalUrl: 'https://provider.example/result.png',
      });
      resultAssetId = resultAsset.id;
    });
    const settledResult = await settlePostgresCreationProviderResult({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      assetId: resultAssetId!.toString(),
    });
    assert.equal(settledResult.reused, false);
    assert.ok(settledResult.ledger);
    aiCreditLedgerIds.push(settledResult.ledger!.id);
    assert.equal(settledResult.asset.ownerId, prepared.generations[0]!.id);
    assert.equal(
      (settledResult.generation.output as { imageUrl?: string }).imageUrl,
      `/api/ai/assets/${resultAssetId!.toString()}/image`
    );
    assert.equal((settledResult.generation.billing as { status?: string }).status, 'consumed');
    assert.equal(settledResult.account.frozenBalance, 0n);
    assert.equal(
      settledResult.account.balance,
      creditGrant.account.balance - firstHeld.account.frozenBalance
    );
    const processingBatch = await refreshPostgresCreationBatchStatus({
      enterpriseId: enterpriseAId.toString(),
      batchId: prepared.batch.id.toString(),
    });
    assert.equal(processingBatch.reused, false);
    assert.equal(processingBatch.batch.status, 'processing');
    const repeatedSettlement = await settlePostgresCreationProviderResult({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      assetId: resultAssetId!.toString(),
    });
    assert.equal(repeatedSettlement.reused, true);
    assert.equal(repeatedSettlement.account.balance, settledResult.account.balance);
    await assert.rejects(
      settlePostgresCreationProviderResult({
        enterpriseId: enterpriseAId.toString(),
        generationId: prepared.generations[0]!.id.toString(),
        attemptId: providerAttempt.attempt.id.toString(),
        remoteTaskId: `${testRunKey}-different-remote-task`,
        assetId: resultAssetId!.toString(),
      }),
      /远端任务 ID 与当前尝试不一致/
    );

    const repeatedAttachment = await attachPostgresCreationProviderResultAsset({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
      attemptId: providerAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-remote-task`,
      assetId: resultAssetId!.toString(),
    });
    assert.equal(repeatedAttachment.reused, true);

    await assert.rejects(
      completePostgresCreationProviderAttempt({
        enterpriseId: enterpriseAId.toString(),
        generationId: prepared.generations[0]!.id.toString(),
        attemptId: providerAttempt.attempt.id.toString(),
        remoteTaskId: `${testRunKey}-different-remote-task`,
      }),
      /远端任务 ID 与当前尝试不一致/
    );

    const directUrlHeld = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[1]!.id.toString(),
    });
    assert.ok(directUrlHeld.ledger);
    aiCreditLedgerIds.push(directUrlHeld.ledger.id);
    const directUrlAttempt = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[1]!.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'integration-provider',
      adapterType: 'grs',
      remoteModel: 'gpt-image-2',
      requestSnapshot: { prompt: 'Keep the provider result URL' },
    });
    await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[1]!.id.toString(),
      attemptId: directUrlAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-direct-url-task`,
      remoteStatus: 'queued',
    });
    await completePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[1]!.id.toString(),
      attemptId: directUrlAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-direct-url-task`,
      remoteStatus: 'completed',
      output: { providerImage: 'https://provider.example/direct-result.png' },
    });
    const directUrlSettled = await settlePostgresCreationProviderUrlResult({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[1]!.id.toString(),
      attemptId: directUrlAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-direct-url-task`,
      imageUrl: 'https://provider.example/direct-result.png',
    });
    assert.equal(directUrlSettled.reused, false);
    assert.ok(directUrlSettled.ledger);
    aiCreditLedgerIds.push(directUrlSettled.ledger.id);
    assert.equal(
      (directUrlSettled.generation.output as { imageUrl?: string }).imageUrl,
      'https://provider.example/direct-result.png'
    );
    assert.equal((directUrlSettled.generation.billing as { status?: string }).status, 'consumed');
    const repeatedDirectUrlSettlement = await settlePostgresCreationProviderUrlResult({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[1]!.id.toString(),
      attemptId: directUrlAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-direct-url-task`,
      imageUrl: 'https://provider.example/direct-result.png',
    });
    assert.equal(repeatedDirectUrlSettlement.reused, true);

    const secondHeld = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[2]!.id.toString(),
    });
    assert.ok(secondHeld.ledger);
    aiCreditLedgerIds.push(secondHeld.ledger.id);
    const secondAttempt = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[2]!.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'integration-provider',
      adapterType: 'grs',
      remoteModel: 'gpt-image-2',
      requestSnapshot: { prompt: 'Fail the second test generation' },
    });
    const acknowledgedSecondAttempt = await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[2]!.id.toString(),
      attemptId: secondAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-failed-remote-task`,
      remoteStatus: 'running',
    });
    const released = await failPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[2]!.id.toString(),
      attemptId: secondAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-failed-remote-task`,
      remoteStatus: 'failed',
      errorCode: 'TEST_PROVIDER_FAILED',
      errorMessage: 'Fail the second test generation',
    });
    assert.equal(acknowledgedSecondAttempt.attempt.status, 'processing');
    assert.ok(released.ledger);
    aiCreditLedgerIds.push(released.ledger.id);
    assert.equal(released.generation.status, 'failed');
    assert.equal((released.generation.billing as { status?: string }).status, 'released');
    assert.equal(released.attempt.status, 'failed');
    assert.equal((released.generation.externalTask as { remoteTaskId?: string }).remoteTaskId, `${testRunKey}-failed-remote-task`);
    assert.equal(released.account.frozenBalance, 0n);

    const partialBatch = await refreshPostgresCreationBatchStatus({
      enterpriseId: enterpriseAId.toString(),
      batchId: prepared.batch.id.toString(),
    });
    assert.equal(partialBatch.reused, false);
    assert.equal(partialBatch.batch.status, 'partial');
    const repeatedBatchRefresh = await refreshPostgresCreationBatchStatus({
      enterpriseId: enterpriseAId.toString(),
      batchId: prepared.batch.id.toString(),
    });
    assert.equal(repeatedBatchRefresh.reused, true);
    assert.equal(repeatedBatchRefresh.batch.status, 'partial');

    const repeatedRelease = await failPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[2]!.id.toString(),
      attemptId: secondAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-failed-remote-task`,
      errorMessage: 'ignored on retry',
    });
    assert.equal(repeatedRelease.reused, true);
    assert.equal(repeatedRelease.account.frozenBalance, released.account.frozenBalance);

    const retriedBatch = await preparePostgresCreationBatchRetry({
      enterpriseId: enterpriseAId.toString(),
      taskId: task.id.toString(),
      batchId: prepared.batch.id.toString(),
    });
    assert.equal(retriedBatch.batch.id, prepared.batch.id);
    assert.equal(retriedBatch.batch.sequence, prepared.batch.sequence);
    assert.equal(retriedBatch.batch.status, 'pending');
    assert.equal(retriedBatch.generations.length, 1);
    assert.equal(retriedBatch.generations[0]?.id, prepared.generations[2]?.id);
    assert.equal(retriedBatch.generations[0]?.status, 'pending');
    assert.equal(retriedBatch.generations[0]?.retryCount, 1);
    assert.equal(retriedBatch.generations[0]?.currentAttemptId, null);
    assert.deepEqual(retriedBatch.generations[0]?.externalTask, {});
    assert.equal((retriedBatch.generations[0]?.billing as { cycle?: number; status?: string }).cycle, 1);
    assert.equal((retriedBatch.generations[0]?.billing as { status?: string }).status, 'unbilled');
    const generationsAfterRetry = await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).listBatchGenerationsForUpdate(prepared.batch.id)
    );
    assert.equal(generationsAfterRetry.filter((generation) => generation.status === 'succeeded').length, 2);
    await assert.rejects(
      preparePostgresCreationBatchRetry({
        enterpriseId: enterpriseAId.toString(),
        taskId: task.id.toString(),
        batchId: prepared.batch.id.toString(),
      }),
      /只有失败或部分失败的当前轮可以重试/
    );

    const repeatedHold = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
    });
    assert.equal(repeatedHold.account.frozenBalance, 0n);
    assert.equal(firstHeld.account.balance, creditGrant.account.balance);

    const consumed = await consumePostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
    });
    assert.equal(consumed.ledger, null);
    assert.equal((consumed.generation.billing as { status?: string }).status, 'consumed');
    assert.equal(consumed.account.frozenBalance, 0n);
    assert.equal(consumed.account.balance, directUrlSettled.account.balance);

    const repeatedConsume = await consumePostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.generations[0]!.id.toString(),
    });
    assert.equal(repeatedConsume.account.balance, consumed.account.balance);
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (taskId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.creationTaskId, taskId));
        await transaction.delete(aiCreationTasks).where(eq(aiCreationTasks.id, taskId));
      }
      if (resultAssetId) await transaction.delete(mediaAssets).where(eq(mediaAssets.id, resultAssetId));
      if (assetId) await transaction.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
    });
  }
});

test('PostgreSQL workbench creation batch requires an eligible workflow floor plan', async () => {
  let leadId: bigint | null = null;
  let workflowId: bigint | null = null;
  let taskId: bigint | null = null;
  try {
    const profiles = await listPostgresExecutableImageModelProfiles();
    const profile = profiles.find((item) => item.key === 'grs-gpt-image-2');
    assert.ok(profile);
    const lead = await withTenantTransaction(enterpriseAId, (transaction) =>
      new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Workbench floor-plan required lead',
        phone: `138${String(Date.now()).slice(-8)}`,
        source: 'integration-test',
        status: 'new',
      })
    );
    leadId = lead.id;
    const workflow = await createPostgresAiWorkflow({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      leadId: lead.id,
      sourceImage: 'data:image/png;base64,AA==',
    });
    workflowId = workflow.id;
    const task = await createPostgresCreationTask({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      modelProfileId: profile!.id.toString(),
      title: 'Workbench conversation',
      prompt: 'Living room warm light',
    });
    taskId = task.id;
    await assert.rejects(
      preparePostgresCreationBatch({
        enterpriseId: enterpriseAId.toString(),
        operatorId: promotionDesignerAId.toString(),
        taskId: task.id.toString(),
        modelProfileId: profile!.id.toString(),
        prompt: 'Living room warm light',
        parameters: { aspectRatio: '1:1', resolutionTier: '1K' },
        count: 1,
        workflowId: workflow.id.toString(),
      }),
      /请先关联合格的正式户型/
    );
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (taskId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.creationTaskId, taskId));
        await transaction.delete(aiCreationTasks).where(eq(aiCreationTasks.id, taskId));
      }
      if (workflowId) await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
      if (leadId) await transaction.delete(leads).where(eq(leads.id, leadId));
    });
  }
});

test('PostgreSQL workbench floor-plan preview renders the bound survey control PNG', async () => {
  const eligibleLayout = {
    version: 4,
    measurementMode: 'surveying',
    surveyGraph: {
      kind: 'survey-wall-graph',
      activeFloorId: 'floor-1',
      floors: [{
        id: 'floor-1',
        name: '一层',
        ceilingHeightMm: 2800,
        nodes: [
          { id: 'n1', xMm: 0, yMm: 0 },
          { id: 'n2', xMm: 4000, yMm: 0 },
          { id: 'n3', xMm: 4000, yMm: 3000 },
          { id: 'n4', xMm: 0, yMm: 3000 },
        ],
        walls: [
          { id: 'w1', startNodeId: 'n1', endNodeId: 'n2' },
          { id: 'w2', startNodeId: 'n2', endNodeId: 'n3' },
          { id: 'w3', startNodeId: 'n3', endNodeId: 'n4' },
          { id: 'w4', startNodeId: 'n4', endNodeId: 'n1' },
        ],
        openings: [],
        spaces: [
          { id: 'living', name: '客厅', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true },
        ],
      }],
    },
  };
  let userId: bigint | null = null;
  let leadId: bigint | null = null;
  let floorPlanId: bigint | null = null;
  let workflowId: bigint | null = null;
  let imageOnlyWorkflowId: bigint | null = null;
  try {
    const created = await withTenantTransaction(enterpriseAId, async (transaction) => {
      const user = await new UserRepository(transaction).create({
        enterpriseId: enterpriseAId,
        role: 'user',
        openid: `${testRunKey}-workbench-floorplan-user`,
        nickname: 'Workbench Floor Plan Customer',
      });
      const plan = await new FloorPlanRepository(transaction).create({
        enterpriseId: enterpriseAId,
        creatorId: user.id,
        staffId: promotionDesignerAId,
        name: 'Workbench control plan',
        layoutData: eligibleLayout,
        source: 'surveying',
        status: 'completed',
        completedAt: new Date(),
      });
      const leadRepository = new LeadRepository(transaction);
      const lead = await leadRepository.create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Workbench floor-plan preview lead',
        phone: `136${String(Date.now()).slice(-8)}`,
        source: 'integration-test',
        status: 'new',
      });
      await leadRepository.linkFloorPlan(lead.id, plan.id);
      return { user, plan, lead };
    });
    userId = created.user.id;
    floorPlanId = created.plan.id;
    leadId = created.lead.id;

    const workflow = await createPostgresAiWorkflow({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      leadId: created.lead.id,
      sourceFloorPlanId: created.plan.id,
      title: '灯光设计',
    });
    workflowId = workflow.id;

    const context = await getPostgresAiWorkflowContext({
      enterpriseId: enterpriseAId,
      workflowId: workflow.id,
    });
    assert.equal(context.workflow.floorPlanPreviewUrl, `/api/ai/workflows/${workflow.id}/floor-plan-preview?v=3`);
    assert.equal(context.workflow.sourceFloorPlan?.id, String(created.plan.id));
    assert.equal(context.workflow.sourceFloorPlan?.name, 'Workbench control plan');

    const png = await getPostgresAiWorkflowFloorPlanPreview({
      enterpriseId: enterpriseAId,
      workflowId: workflow.id,
    });
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.length > 1000);

    const roomPng = await getPostgresAiWorkflowFloorPlanPreview({
      enterpriseId: enterpriseAId,
      workflowId: workflow.id,
      roomId: 'living',
    });
    assert.deepEqual([...roomPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(roomPng.length > 1000);
    await assert.rejects(
      () => getPostgresAiWorkflowFloorPlanPreview({
        enterpriseId: enterpriseAId,
        workflowId: workflow.id,
        roomId: 'missing-room',
      }),
      /所选房间不属于该户型或尚未闭合/,
    );

    const storedPlan = await withTenantTransaction(enterpriseAId, (transaction) =>
      new FloorPlanRepository(transaction).findById(created.plan.id)
    );
    assert.ok(storedPlan?.previewAssetId);
    assert.equal(storedPlan?.previewRenderRevision, RENDER_REVISION);

    await assert.rejects(
      () => getPostgresAiWorkflowFloorPlanPreview({
        enterpriseId: enterpriseBId,
        workflowId: workflow.id,
      }),
      /方案会话不存在或无权访问/
    );

    const imageOnly = await createPostgresAiWorkflow({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      leadId: created.lead.id,
      sourceImage: 'data:image/png;base64,AA==',
      title: '无户型对话',
    });
    imageOnlyWorkflowId = imageOnly.id;
    const imageOnlyContext = await getPostgresAiWorkflowContext({
      enterpriseId: enterpriseAId,
      workflowId: imageOnly.id,
    });
    assert.equal(imageOnlyContext.workflow.floorPlanPreviewUrl, undefined);
    assert.equal(imageOnlyContext.workflow.sourceFloorPlan, null);
    await assert.rejects(
      () => getPostgresAiWorkflowFloorPlanPreview({
        enterpriseId: enterpriseAId,
        workflowId: imageOnly.id,
      }),
      /方案尚未关联正式户型/
    );
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (imageOnlyWorkflowId) await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, imageOnlyWorkflowId));
      if (workflowId) await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
      if (leadId) await transaction.delete(leads).where(eq(leads.id, leadId));
      if (floorPlanId) await transaction.delete(floorPlans).where(eq(floorPlans.id, floorPlanId));
      if (userId) await transaction.delete(users).where(eq(users.id, userId));
    });
  }
});

test('AI creation repository preserves tenant-scoped media, task, batch, generation, and attempt relations', async () => {
  let profileId: bigint | null = null;
  let assetId: bigint | null = null;
  let taskId: bigint | null = null;
  try {
    const created = await withTenantTransaction(enterpriseAId, async (transaction) => {
      const profiles = new AiCreationModelProfileRepository(transaction);
      await profiles.ensureCatalogProfiles([{
        key: `${testRunKey}-creation-runtime`,
        name: 'Creation runtime profile',
        sourceModelSourceIds: [],
        sourceType: 'grs_catalog',
        adapterType: 'grs',
        remoteModel: 'integration-model',
        family: 'integration',
        catalogVersion: 'integration-v1',
        generateLogicalModelKey: 'image.generate.standard',
        editLogicalModelKey: 'image.edit.standard',
        capabilities: { supportsReferenceImages: true, maxReferenceImages: 1 },
        defaults: { aspectRatio: '1:1', resolutionTier: '1K' },
        enabled: true,
        isDefault: false,
        weight: 1,
      }]);
      const profile = await profiles.findByKey(`${testRunKey}-creation-runtime`);
      assert.ok(profile);
      profileId = profile.id;

      const repository = new AiCreationRepository(transaction);
      const asset = await repository.createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'manual_upload',
        mimeType: 'image/png',
        size: 4n,
        width: 1,
        height: 1,
        storageProvider: 'local',
        storageKey: `${testRunKey}/creation-reference.png`,
      });
      assetId = asset.id;
      const task = await repository.createTask({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        modelProfileId: profile.id,
        title: 'Creation integration task',
        prompt: 'Create an integration image',
        referenceAssetIds: [asset.id],
      });
      taskId = task.id;
      const batch = await repository.createBatch({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        taskId: task.id,
        modelProfileId: profile.id,
        sequence: await repository.nextBatchSequence(task.id),
        prompt: task.prompt,
        modelProfileSnapshot: { key: profile.key },
        parameterSnapshot: { aspectRatio: '1:1', resolutionTier: '1K' },
        requestedCount: 1,
        status: 'processing',
        creditsEstimate: 10n,
      }, [asset.id]);
      const generation = await repository.createGeneration({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        creationTaskId: task.id,
        creationBatchId: batch.id,
        creationModelProfileId: profile.id,
        type: 'free_create',
        channel: 'admin',
        input: { style: 'free_create', customPrompt: task.prompt },
        output: {},
        status: 'processing',
        actionKey: 'image.free_create',
        billing: { status: 'held', price: 10 },
      });
      const attempt = await repository.createProviderAttempt({
        enterpriseId: enterpriseAId,
        generationId: generation.id,
        providerConfigId: aiProviderConfigId,
        providerKey: 'integration-provider',
        adapterType: 'grs',
        capability: 'image.generate',
        logicalModelKey: 'image.generate.standard',
        remoteModel: 'integration-model',
        resolutionTier: '1K',
        status: 'processing',
        accepted: true,
        estimatedCost: { currency: 'USD', micros: 10 },
      });
      await repository.updateGeneration(generation.id, { currentAttemptId: attempt.id });
      await repository.updateTask(task.id, { lastBatchId: batch.id, prompt: 'Updated integration prompt' });
      const view = await repository.loadTaskView(task.id);
      assert.ok(view);
      assert.equal(view.referenceAssetIds[0], asset.id);
      assert.equal(view.batches.length, 1);
      assert.equal(view.batches[0].referenceAssetIds[0], asset.id);
      assert.equal(view.batches[0].generations[0].currentAttemptId, attempt.id);
      const history = await repository.listHistory({
        page: 1,
        limit: 10,
        types: ['free_create'],
      });
      assert.ok(history.rows.some((row) => row.id === generation.id));
      return { task, batch, generation };
    });

    const crossTenant = await withTenantTransaction(enterpriseBId, async (transaction) => {
      const repository = new AiCreationRepository(transaction);
      return {
        task: await repository.findTask(created.task.id),
        asset: await repository.findMediaAsset(assetId!),
        generation: await repository.findGeneration(created.generation.id),
        history: await repository.listHistory({
          page: 1,
          limit: 10,
          types: ['free_create'],
        }),
      };
    });
    assert.equal(crossTenant.task, null);
    assert.equal(crossTenant.asset, null);
    assert.equal(crossTenant.generation, null);
    assert.ok(!crossTenant.history.rows.some((row) => row.id === created.generation.id));

    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const archived = await new AiCreationRepository(transaction).archiveTask(taskId!);
      assert.ok(archived);
      assert.equal(await new AiCreationRepository(transaction).findTask(taskId!), null);
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (taskId) {
        await transaction
          .delete(aiGenerations)
          .where(eq(aiGenerations.creationTaskId, taskId));
      }
      if (taskId) await transaction.delete(aiCreationTasks).where(eq(aiCreationTasks.id, taskId));
      if (assetId) await transaction.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
      if (profileId) await transaction.delete(aiCreationModelProfiles).where(eq(aiCreationModelProfiles.id, profileId));
    });
  }
});

test('PostgreSQL media storage commits asset metadata only after object upload under tenant RLS', async () => {
  const objects = new Map<string, Buffer>();
  const provider = {
    key: 'integration-memory',
    async putObject(input: { objectKey: string; buffer: Buffer }) {
      objects.set(input.objectKey, Buffer.from(input.buffer));
      return {};
    },
    async getObject(input: { objectKey: string }) {
      const value = objects.get(input.objectKey);
      if (!value) throw new Error('Object not found');
      return Buffer.from(value);
    },
    async deleteObject(input: { objectKey: string }) {
      objects.delete(input.objectKey);
    },
  };
  let assetId: bigint | null = null;

  try {
    const stored = await storePostgresMediaBuffer({
      enterpriseId: enterpriseAId,
      ownerType: 'manual_upload',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('postgres-media-integration'),
      provider,
    });
    assetId = stored.asset.id;
    assert.equal(stored.asset.enterpriseId, enterpriseAId);
    assert.equal(stored.asset.size, BigInt('postgres-media-integration'.length));
    assert.ok(objects.has(stored.asset.storageKey));

    const crossTenant = await withTenantTransaction(enterpriseBId, (transaction) =>
      new AiCreationRepository(transaction).findMediaAsset(assetId!)
    );
    assert.equal(crossTenant, null);
  } finally {
    if (assetId) {
      await withPlatformTransaction((transaction) =>
        transaction.delete(mediaAssets).where(eq(mediaAssets.id, assetId!))
      );
    }
  }
});

test('enterprise AI usage snapshots preserve PostgreSQL tenant isolation', async () => {
  const syncedAt = new Date();
  const snapshot = await withTenantTransaction(enterpriseAId, (transaction) =>
    new EnterpriseAiUsageSnapshotRepository(transaction).upsert({
      enterpriseId: enterpriseAId,
      balance: '42.5',
      currency: 'USD',
      dailyUsage: [
        {
          date: syncedAt.toISOString().slice(0, 10),
          model: 'usage-integration-model',
          requests: 3,
          costUsd: 1.25,
          meterSource: 'integration-test',
        },
      ],
      keyInfo: { valid: true, allowedModels: ['usage-integration-model'] },
      lastSyncedAt: syncedAt,
      syncError: '',
    })
  );
  assert.equal(snapshot.enterpriseId, enterpriseAId);
  assert.equal(snapshot.balance, '42.500000');

  const ownSnapshot = await withTenantTransaction(enterpriseAId, (transaction) =>
    new EnterpriseAiUsageSnapshotRepository(transaction).findByEnterpriseId(enterpriseAId)
  );
  assert.equal(ownSnapshot?.id, snapshot.id);

  const otherTenantSnapshot = await withTenantTransaction(enterpriseBId, (transaction) =>
    new EnterpriseAiUsageSnapshotRepository(transaction).findByEnterpriseId(enterpriseAId)
  );
  assert.equal(otherTenantSnapshot, null);
});

test('inspiration repository uses tenant-scoped PostgreSQL case records', async () => {
  const style = `${testRunKey}-inspiration-style`;
  let ownId: bigint | null = null;
  let otherId: bigint | null = null;
  try {
    ownId = await withTenantTransaction(enterpriseAId, (transaction) =>
      new InspirationRepository(transaction).create({
        enterpriseId: enterpriseAId,
        title: `${testRunKey} Tenant A inspiration`,
        coverImage: 'data:image/png;base64,AA==',
        renderingImage: 'data:image/png;base64,BB==',
        style,
        roomType: 'living-room',
        layoutData: { source: 'integration' },
        isRecommended: true,
        viewCount: BigInt(7),
      })
    ).then((record) => record.id);
    otherId = await withTenantTransaction(enterpriseBId, (transaction) =>
      new InspirationRepository(transaction).create({
        enterpriseId: enterpriseBId,
        title: `${testRunKey} Tenant B inspiration`,
        coverImage: 'data:image/png;base64,CC==',
        renderingImage: 'data:image/png;base64,DD==',
        style,
        roomType: 'living-room',
        layoutData: { source: 'integration' },
      })
    ).then((record) => record.id);

    const ownRows = await withTenantTransaction(enterpriseAId, (transaction) =>
      new InspirationRepository(transaction).list({ style, isRecommended: true })
    );
    assert.equal(ownRows.length, 1);
    assert.equal(ownRows[0]?.id, ownId);
    assert.equal(ownRows[0]?.viewCount, BigInt(7));

    const otherTenantRows = await withTenantTransaction(enterpriseBId, (transaction) =>
      new InspirationRepository(transaction).list({ style, isRecommended: true })
    );
    assert.equal(otherTenantRows.length, 0);

    await withTenantTransaction(enterpriseAId, (transaction) =>
      new InspirationRepository(transaction).delete(ownId!)
    );
    const afterDelete = await withTenantTransaction(enterpriseAId, (transaction) =>
      new InspirationRepository(transaction).list({ style })
    );
    assert.equal(afterDelete.length, 0);
    ownId = null;
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (ownId) await transaction.delete(inspirations).where(eq(inspirations.id, ownId));
      if (otherId) await transaction.delete(inspirations).where(eq(inspirations.id, otherId));
    });
  }
});

test('enterprise AI credit task reads use PostgreSQL generations and operator names', async () => {
  let ownGenerationId: bigint | null = null;
  let otherGenerationId: bigint | null = null;
  try {
    ownGenerationId = await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).createGeneration({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        type: 'miniprogram',
        channel: 'miniprogram',
        actionKey: 'image.scenario',
        status: 'processing',
        provider: 'integration-provider',
        logicalModelKey: 'image.generate.standard',
        externalTask: { status: 'queued' },
        billing: { status: 'held', price: 12 },
      })
    ).then((generation) => generation.id);
    otherGenerationId = await withTenantTransaction(enterpriseBId, (transaction) =>
      new AiCreationRepository(transaction).createGeneration({
        enterpriseId: enterpriseBId,
        operatorId: promotionPromoterBId,
        type: 'scenario',
        status: 'succeeded',
        billing: { status: 'consumed', price: 8 },
      })
    ).then((generation) => generation.id);

    const rows = await withPlatformTransaction((transaction) =>
      new AiCreationRepository(transaction).listEnterpriseGenerationsWithOperators(enterpriseAId)
    );
    const own = rows.find((item) => item.generation.id === ownGenerationId);
    assert.equal(own?.generation.enterpriseId, enterpriseAId);
    assert.equal(own?.generation.actionKey, 'image.scenario');
    assert.equal(own?.generation.externalTask?.status, 'queued');
    assert.ok(own?.operatorDisplayName || own?.operatorUsername);
    assert.ok(!rows.some((item) => item.generation.id === otherGenerationId));
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (ownGenerationId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.id, ownGenerationId));
      }
      if (otherGenerationId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.id, otherGenerationId));
      }
    });
  }
});

test('PostgreSQL advice generations use the tenant-scoped credit lifecycle', async () => {
  let generationId: bigint | null = null;
  const ledgerIds: bigint[] = [];
  try {
    const generation = await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).createGeneration({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        type: 'advice',
        channel: 'admin',
        actionKey: 'text.design_advice',
        capability: 'chat',
        logicalModelKey: 'chat.general',
        status: 'pending',
        input: { style: 'test-advice' },
        output: {},
        billing: { cycle: 0, actionKey: 'text.design_advice', price: 1, status: 'unbilled' },
      })
    );
    generationId = generation.id;

    const grant = await grantAiCredits({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      amount: 1,
      operationId: `${testRunKey}:advice-grant`,
    });
    ledgerIds.push(grant.ledger.id);
    const held = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: generation.id.toString(),
    });
    assert.equal(held.generation.status, 'created');
    assert.equal((held.generation.billing as { status?: string }).status, 'held');
    if (held.ledger) ledgerIds.push(held.ledger.id);

    await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).updateGeneration(generation.id, {
        status: 'succeeded',
        output: { adviceText: 'Use warm indirect lighting.' },
      })
    );
    const consumed = await consumePostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: generation.id.toString(),
    });
    assert.equal((consumed.generation.billing as { status?: string }).status, 'consumed');
    if (consumed.ledger) ledgerIds.push(consumed.ledger.id);

    const crossTenant = await withTenantTransaction(enterpriseBId, (transaction) =>
      new AiCreationRepository(transaction).findGeneration(generation.id)
    );
    assert.equal(crossTenant, null);
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (ledgerIds.length) {
        await transaction.delete(aiCreditLedgers).where(inArray(aiCreditLedgers.id, ledgerIds));
      }
      if (generationId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.id, generationId));
      }
    });
  }
});

test('PostgreSQL soft-furnishing generations use the image execution lifecycle', async () => {
  let generationId: bigint | null = null;
  let sourceAssetId: bigint | null = null;
  const ledgerIds: bigint[] = [];
  try {
    const created = await withTenantTransaction(enterpriseAId, async (transaction) => {
      const repository = new AiCreationRepository(transaction);
      const asset = await repository.createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'ai_generation_input',
        mimeType: 'image/png',
        size: BigInt(4),
        width: 1,
        height: 1,
        storageProvider: 'local',
        storageKey: `${testRunKey}/soft-furnishing-source.png`,
      });
      const generation = await repository.createGeneration({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        type: 'soft_furnishing_render',
        channel: 'admin',
        actionKey: 'image.soft_furnishing_render',
        capability: 'image.edit',
        logicalModelKey: 'image.edit.standard',
        status: 'pending',
        input: {
          sourceImage: `/api/ai/assets/${asset.id.toString()}/image`,
          customPrompt: 'Add soft furnishings while preserving the room.',
          negativePrompt: 'changed room structure',
          outputAspectRatio: '3:2',
          outputSize: '1024x1024',
        },
        output: {},
        billing: { cycle: 0, actionKey: 'image.soft_furnishing_render', price: 1, status: 'unbilled' },
      });
      return { asset, generation };
    });
    generationId = created.generation.id;
    sourceAssetId = created.asset.id;

    const grant = await grantAiCredits({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      amount: 1,
      operationId: `${testRunKey}:soft-furnishing-grant`,
    });
    ledgerIds.push(grant.ledger.id);
    const held = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
    });
    if (held.ledger) ledgerIds.push(held.ledger.id);
    assert.equal(held.generation.status, 'created');

    const begun = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'integration-provider',
      adapterType: 'grs',
      remoteModel: 'gpt-image-2',
      requestSnapshot: { prompt: 'Add soft furnishings while preserving the room.' },
    });
    const acknowledged = await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
      attemptId: begun.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-soft-furnishing-remote-task`,
      remoteStatus: 'queued',
      nextPollAfterMs: 0,
    });
    await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).updateGeneration(created.generation.id, {
        externalTask: {
          ...(acknowledged.generation.externalTask as Record<string, unknown>),
          nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        },
      })
    );
    const claims = await claimPostgresCreationProviderPolls({
      enterpriseId: enterpriseAId.toString(),
      limit: 20,
    });
    assert.ok(claims.some((claim) => claim.generationId === created.generation.id.toString()));
    assert.equal(acknowledged.generation.status, 'processing');

    const released = await releasePostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
      errorMessage: 'Integration test cleanup',
    });
    if (released.ledger) ledgerIds.push(released.ledger.id);
    assert.equal((released.generation.billing as { status?: string }).status, 'released');

    await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).updateGeneration(created.generation.id, {
        status: 'pending',
        retryCount: 1,
        billing: {
          ...(released.generation.billing as Record<string, unknown>),
          cycle: 1,
          status: 'unbilled',
        },
      })
    );
    const retried = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
    });
    if (retried.ledger) ledgerIds.push(retried.ledger.id);
    assert.equal((retried.generation.billing as { cycle?: number; status?: string }).cycle, 1);
    assert.equal((retried.generation.billing as { status?: string }).status, 'held');
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (ledgerIds.length) {
        await transaction.delete(aiCreditLedgers).where(inArray(aiCreditLedgers.id, ledgerIds));
      }
      if (generationId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.id, generationId));
      }
      if (sourceAssetId) {
        await transaction.delete(mediaAssets).where(eq(mediaAssets.id, sourceAssetId));
      }
    });
  }
});

test('PostgreSQL two-step direct generations use the image execution lifecycle', async () => {
  let generationId: bigint | null = null;
  let sourceAssetId: bigint | null = null;
  const ledgerIds: bigint[] = [];
  try {
    const created = await withTenantTransaction(enterpriseAId, async (transaction) => {
      const repository = new AiCreationRepository(transaction);
      const asset = await repository.createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'ai_generation_input',
        mimeType: 'image/png',
        size: BigInt(4),
        width: 1,
        height: 1,
        storageProvider: 'local',
        storageKey: `${testRunKey}/two-step-direct-source.png`,
      });
      const generation = await repository.createGeneration({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        type: 'furnishing_render',
        channel: 'admin',
        actionKey: 'image.furnishing_render',
        capability: 'image.edit',
        logicalModelKey: 'image.edit.standard',
        status: 'pending',
        input: {
          style: 'modern',
          sourceImage: `/api/ai/assets/${asset.id.toString()}/image`,
          customPrompt: 'Render the supplied floor plan as a modern furnished home.',
          presetSnapshot: { image: { mode: 'edit', size: '1024x1024', quality: 'medium' } },
        },
        output: {},
        billing: { cycle: 0, actionKey: 'image.furnishing_render', price: 1, status: 'unbilled' },
      });
      return { asset, generation };
    });
    generationId = created.generation.id;
    sourceAssetId = created.asset.id;

    const grant = await grantAiCredits({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      amount: 1,
      operationId: `${testRunKey}:two-step-direct-grant`,
    });
    ledgerIds.push(grant.ledger.id);
    const held = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
    });
    if (held.ledger) ledgerIds.push(held.ledger.id);
    assert.equal(held.generation.status, 'created');

    const begun = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'integration-provider',
      adapterType: 'grs',
      remoteModel: 'gpt-image-2',
      requestSnapshot: { prompt: 'Render the supplied floor plan as a modern furnished home.' },
    });
    const acknowledged = await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
      attemptId: begun.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-two-step-direct-remote-task`,
      remoteStatus: 'queued',
      nextPollAfterMs: 0,
    });
    await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).updateGeneration(created.generation.id, {
        externalTask: {
          ...(acknowledged.generation.externalTask as Record<string, unknown>),
          nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        },
      })
    );
    const claims = await claimPostgresCreationProviderPolls({
      enterpriseId: enterpriseAId.toString(),
      limit: 20,
    });
    assert.ok(claims.some((claim) => claim.generationId === created.generation.id.toString()));
    assert.equal(acknowledged.generation.status, 'processing');

    const released = await releasePostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: created.generation.id.toString(),
      errorMessage: 'Integration test cleanup',
    });
    if (released.ledger) ledgerIds.push(released.ledger.id);
    assert.equal((released.generation.billing as { status?: string }).status, 'released');
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (ledgerIds.length) {
        await transaction.delete(aiCreditLedgers).where(inArray(aiCreditLedgers.id, ledgerIds));
      }
      if (generationId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.id, generationId));
      }
      if (sourceAssetId) {
        await transaction.delete(mediaAssets).where(eq(mediaAssets.id, sourceAssetId));
      }
    });
  }
});

test('AI workflow repository atomically attaches succeeded free creations under tenant RLS', async () => {
  let leadId: bigint | null = null;
  let workflowId: bigint | null = null;
  const generationIds: bigint[] = [];
  try {
    const created = await withTenantTransaction(enterpriseAId, async (transaction) => {
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Workflow attachment integration lead',
        phone: `136${String(Date.now()).slice(-8)}`,
        source: 'integration-test',
        status: 'new',
      });
      leadId = lead.id;
      const workflows = new AiWorkflowRepository(transaction);
      const workflow = await workflows.create({
        enterpriseId: enterpriseAId,
        leadId: lead.id,
        operatorId: promotionDesignerAId,
        title: 'Workflow attachment integration',
        sourceAssetRole: 'floor_plan',
        currentStageKey: 'direction',
      });
      workflowId = workflow.id;
      const [firstGeneration, secondGeneration] = await transaction
        .insert(aiGenerations)
        .values([
          {
            enterpriseId: enterpriseAId,
            operatorId: promotionDesignerAId,
            type: 'free_create',
            status: 'succeeded',
            input: { style: 'free_create' },
            output: { imageUrl: 'https://example.test/first.png' },
          },
          {
            enterpriseId: enterpriseAId,
            operatorId: promotionDesignerAId,
            type: 'free_create',
            status: 'succeeded',
            input: { style: 'free_create' },
            output: { imageUrl: 'https://example.test/second.png' },
          },
        ])
        .returning();
      generationIds.push(firstGeneration.id, secondGeneration.id);

      const firstAttachment = await workflows.attachSucceededFreeCreationGeneration(
        workflow.id,
        firstGeneration.id
      );
      assert.ok(firstAttachment);
      assert.equal(firstAttachment.workflow.selectedGenerationId, firstGeneration.id);
      assert.equal(firstAttachment.workflow.lastGenerationId, firstGeneration.id);
      assert.equal(firstAttachment.workflow.currentStageKey, 'soft_furnishing');
      assert.equal(firstAttachment.generation.leadId, lead.id);
      assert.equal(firstAttachment.generation.isSelectedBaseline, true);

      const secondAttachment = await workflows.attachSucceededFreeCreationGeneration(
        workflow.id,
        secondGeneration.id
      );
      assert.ok(secondAttachment);
      assert.equal(secondAttachment.workflow.selectedGenerationId, firstGeneration.id);
      assert.equal(secondAttachment.workflow.lastGenerationId, secondGeneration.id);
      assert.equal(secondAttachment.generation.isSelectedBaseline, false);

      const selectedSecond = await workflows.selectSucceededGenerationBaseline(
        workflow.id,
        secondGeneration.id
      );
      assert.ok(selectedSecond);
      assert.equal(selectedSecond.workflow.selectedGenerationId, secondGeneration.id);
      assert.equal(selectedSecond.workflow.lastGenerationId, secondGeneration.id);
      assert.equal(selectedSecond.generation.isSelectedBaseline, true);
      assert.equal(
        (await new AiCreationRepository(transaction).findGeneration(firstGeneration.id))?.isSelectedBaseline,
        false
      );

      const listed = await workflows.list({ leadId: lead.id, status: 'active' });
      assert.equal(listed.total, 1);
      const summaries = await workflows.summarizeActiveByLeadIds([lead.id]);
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0]?.leadId, lead.id);
      assert.equal(summaries[0]?.count, 1);
      assert.equal(summaries[0]?.latestWorkflowId, workflow.id);
      assert.equal(summaries[0]?.latestWorkflowTitle, workflow.title);
      assert.ok(summaries[0]?.latestUpdatedAt.getTime() >= workflow.updatedAt.getTime());
      const matchingLeads = await new LeadRepository(transaction).list({
        query: 'workflow attachment',
        orderBy: 'updatedAt',
      });
      assert.equal(matchingLeads.total, 1);
      assert.equal(matchingLeads.rows[0]?.id, lead.id);
      return { workflow, firstGeneration, secondGeneration };
    });

    const crossTenant = await withTenantTransaction(enterpriseBId, async (transaction) => ({
      workflow: await new AiWorkflowRepository(transaction).findById(created.workflow.id),
      firstGeneration: await new AiCreationRepository(transaction).findGeneration(created.firstGeneration.id),
    }));
    assert.deepEqual(crossTenant, { workflow: null, firstGeneration: null });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (workflowId) {
        await transaction
          .update(aiWorkflows)
          .set({ selectedGenerationId: null, lastGenerationId: null, updatedAt: new Date() })
          .where(eq(aiWorkflows.id, workflowId));
        await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
      }
      if (generationIds.length) {
        await transaction.delete(aiGenerations).where(inArray(aiGenerations.id, generationIds));
      }
      if (leadId) await transaction.delete(leads).where(eq(leads.id, leadId));
    });
  }
});

test('Mini Program workflow results become a baseline only after their persisted success', async () => {
  let leadId: bigint | null = null;
  let workflowId: bigint | null = null;
  let generationId: bigint | null = null;
  try {
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Mini Program workflow synchronization lead',
        phone: `135${String(Date.now()).slice(-8)}`,
        source: 'integration-test',
        status: 'new',
      });
      leadId = lead.id;
      const workflows = new AiWorkflowRepository(transaction);
      const workflow = await workflows.create({
        enterpriseId: enterpriseAId,
        leadId: lead.id,
        operatorId: promotionDesignerAId,
        title: 'Mini Program workflow synchronization',
        sourceAssetRole: 'floor_plan',
        currentStageKey: 'base_render',
      });
      workflowId = workflow.id;
      const [generation] = await transaction
        .insert(aiGenerations)
        .values({
          enterpriseId: enterpriseAId,
          operatorId: promotionDesignerAId,
          leadId: lead.id,
          workflowId: workflow.id,
          type: 'miniprogram',
          channel: 'miniprogram',
          stageKey: 'base_render',
          nextRecommendedStage: 'soft_furnishing',
          status: 'succeeded',
          input: { roomData: { targetScope: 'whole_floor_plan' } },
          output: { imageUrl: 'https://example.test/mini-program-result.png' },
        })
        .returning();
      generationId = generation.id;

      const synchronized = await workflows.applySucceededWorkflowGeneration(generation.id);
      assert.ok(synchronized);
      assert.equal(synchronized.workflow.selectedGenerationId, generation.id);
      assert.equal(synchronized.workflow.lastGenerationId, generation.id);
      assert.equal(synchronized.workflow.currentStageKey, 'soft_furnishing');
      assert.equal(synchronized.generation.isSelectedBaseline, true);
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (workflowId) {
        await transaction
          .update(aiWorkflows)
          .set({ selectedGenerationId: null, lastGenerationId: null, updatedAt: new Date() })
          .where(eq(aiWorkflows.id, workflowId));
      }
      if (generationId) await transaction.delete(aiGenerations).where(eq(aiGenerations.id, generationId));
      if (workflowId) await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
      if (leadId) await transaction.delete(leads).where(eq(leads.id, leadId));
    });
  }
});

test('PostgreSQL workflow service creates and reads tenant-scoped workflow context', async () => {
  let leadId: bigint | null = null;
  let workflowId: bigint | null = null;
  let generationId: bigint | null = null;
  try {
    const lead = await withTenantTransaction(enterpriseAId, (transaction) =>
      new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'PostgreSQL workflow service lead',
        phone: `137${String(Date.now()).slice(-8)}`,
        source: 'integration-test',
        status: 'new',
      })
    );
    leadId = lead.id;

    const workflow = await createPostgresAiWorkflow({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      leadId: lead.id,
      sourceImage: 'data:image/png;base64,AA==',
    });
    workflowId = workflow.id;
    assert.equal(workflow.isPrimary, true);
    assert.equal(workflow.sourceAssetRole, 'rough_sketch');

    const context = await getPostgresAiWorkflowContext({
      enterpriseId: enterpriseAId,
      workflowId: workflow.id,
    });
    assert.equal(context.workflow.id, String(workflow.id));
    assert.equal(context.workflow.generationCount, 0);
    assert.equal(context.workflow.sourceImage, `/api/ai/workflows/${workflow.id}/source-image`);
    assert.equal(context.lead.id, String(lead.id));
    assert.equal(context.lead.name, lead.name);
    assert.deepEqual(context.generations, []);
    assert.equal(
      await getPostgresAiWorkflowSourceImage({ enterpriseId: enterpriseAId, workflowId: workflow.id }),
      'data:image/png;base64,AA=='
    );
    const listed = await listPostgresAiWorkflows({
      enterpriseId: enterpriseAId,
      query: 'PostgreSQL workflow service lead',
    });
    assert.equal(listed.pagination.total, 1);
    assert.equal(listed.data[0]?.id, workflow.id.toString());
    assert.equal(listed.data[0]?.generationCount, 0);
    assert.equal(listed.data[0]?.lead?.id, lead.id.toString());
    const crossTenantListed = await listPostgresAiWorkflows({
      enterpriseId: enterpriseBId,
      query: 'PostgreSQL workflow service lead',
    });
    assert.deepEqual(crossTenantListed.data, []);

    await withTenantTransaction(enterpriseAId, (transaction) =>
      new EnterpriseRepository(transaction).update(enterpriseAId, {
        aiPolicy: { enabledActionKeys: ['image.free_create', 'image.scenario'] },
      })
    );

    const prepared = await preparePostgresAiWorkflowStage({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      workflowId: workflow.id,
      stageKey: 'direction',
    });
    generationId = prepared.id;
    assert.equal(prepared.type, 'scenario');
    assert.equal(prepared.status, 'pending');
    assert.equal(prepared.workflowId, workflow.id);
    assert.equal(prepared.actionKey, 'image.scenario');
    assert.equal((prepared.billing as { status?: string }).status, 'unbilled');

    await assert.rejects(
      () => preparePostgresAiWorkflowStage({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        workflowId: workflow.id,
        stageKey: 'direction',
      }),
      /该步骤已在生成中/
    );

    const scenarioGrant = await grantAiCredits({
      enterpriseId: enterpriseAId.toString(),
      operatorId: promotionDesignerAId.toString(),
      amount: Number((prepared.billing as { price?: number }).price),
      operationId: `${testRunKey}:workflow-scenario-grant`,
    });
    aiCreditLedgerIds.push(scenarioGrant.ledger.id);
    const scenarioHold = await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.id.toString(),
    });
    assert.equal(scenarioHold.generation.status, 'created');
    assert.equal((scenarioHold.generation.billing as { status?: string }).status, 'held');
    assert.equal(scenarioHold.account.frozenBalance >= BigInt(1), true);
    if (scenarioHold.ledger) aiCreditLedgerIds.push(scenarioHold.ledger.id);

    const scenarioRelease = await releasePostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: prepared.id.toString(),
      errorMessage: 'Workflow-stage submission was intentionally skipped',
    });
    assert.equal(scenarioRelease.generation.status, 'failed');
    assert.equal((scenarioRelease.generation.billing as { status?: string }).status, 'released');
    if (scenarioRelease.ledger) aiCreditLedgerIds.push(scenarioRelease.ledger.id);

    const renamed = await updatePostgresAiWorkflowState({
      enterpriseId: enterpriseAId,
      workflowId: workflow.id,
      action: 'rename',
      title: 'Renamed PostgreSQL workflow',
    });
    assert.equal(renamed.workflow.title, 'Renamed PostgreSQL workflow');
    const staged = await updatePostgresAiWorkflowState({
      enterpriseId: enterpriseAId,
      workflowId: workflow.id,
      action: 'set-stage',
      stageKey: 'base_render',
    });
    assert.equal(staged.workflow.currentStageKey, 'base_render');

    await assert.rejects(
      () => updatePostgresAiWorkflowState({
        enterpriseId: enterpriseBId,
        workflowId: workflow.id,
        action: 'rename',
        title: 'Cross-tenant mutation',
      }),
      /方案会话不存在或无权访问/
    );

    await assert.rejects(
      () => getPostgresAiWorkflowContext({ enterpriseId: enterpriseBId, workflowId: workflow.id }),
      /方案会话不存在或无权访问/
    );
    await assert.rejects(
      () => getPostgresAiWorkflowSourceImage({ enterpriseId: enterpriseBId, workflowId: workflow.id }),
      /Workflow not found or access denied/
    );
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (generationId) {
        await transaction.delete(aiGenerations).where(eq(aiGenerations.id, generationId));
      }
      if (workflowId) {
        await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
      }
      if (leadId) await transaction.delete(leads).where(eq(leads.id, leadId));
    });
  }
});

test('PostgreSQL workflow manual generation stores a tenant-owned scenario result', async () => {
  let leadId: bigint | null = null;
  let workflowId: bigint | null = null;
  let generationId: bigint | null = null;
  let assetId: bigint | null = null;
  try {
    const created = await withTenantTransaction(enterpriseAId, async (transaction) => {
      const lead = await new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Manual workflow generation lead',
        phone: `138${String(Date.now()).slice(-8)}`,
        source: 'integration-test',
        status: 'new',
      });
      const workflow = await new AiWorkflowRepository(transaction).create({
        enterpriseId: enterpriseAId,
        leadId: lead.id,
        operatorId: promotionDesignerAId,
        title: 'Manual workflow generation',
        sourceAssetRole: 'rough_sketch',
        currentStageKey: 'direction',
      });
      const asset = await new AiCreationRepository(transaction).createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'manual_upload',
        mimeType: 'image/png',
        size: BigInt(1),
        storageProvider: 'local',
        storageKey: `${testRunKey}/manual-workflow-output.png`,
      });
      return { lead, workflow, asset };
    });
    leadId = created.lead.id;
    workflowId = created.workflow.id;
    assetId = created.asset.id;

    const generation = await createPostgresAiWorkflowManualGeneration({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      workflowId: created.workflow.id,
      stageKey: 'direction',
      imageUrl: `/api/ai/assets/${created.asset.id}/image`,
      sourceAssetRole: 'rough_sketch',
      nextStageKey: 'base_render',
    });
    generationId = generation.id;
    assert.equal(generation.type, 'scenario');
    assert.equal(generation.status, 'succeeded');
    assert.equal(generation.provider, 'manual_upload');
    assert.equal((generation.billing as { price?: number }).price, 0);

    const persisted = await withTenantTransaction(enterpriseAId, async (transaction) => ({
      workflow: await new AiWorkflowRepository(transaction).findById(created.workflow.id),
      generation: await new AiCreationRepository(transaction).findGeneration(generation.id),
      asset: await new AiCreationRepository(transaction).findMediaAsset(created.asset.id),
    }));
    assert.equal(persisted.workflow?.currentStageKey, 'base_render');
    assert.equal(persisted.generation?.workflowId, created.workflow.id);
    assert.equal((persisted.generation?.output as { imageUrl?: string }).imageUrl, `/api/ai/assets/${created.asset.id}/image`);
    assert.equal(persisted.asset?.ownerType, 'ai_generation_output');
    assert.equal(persisted.asset?.ownerId, generation.id);

    await assert.rejects(
      () => createPostgresAiWorkflowManualGeneration({
        enterpriseId: enterpriseBId,
        operatorId: promotionDesignerAId,
        workflowId: created.workflow.id,
        stageKey: 'direction',
        imageUrl: `/api/ai/assets/${created.asset.id}/image`,
      }),
      /方案会话不存在或无权访问/
    );
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (workflowId) {
        await transaction.update(aiWorkflows)
          .set({ selectedGenerationId: null, lastGenerationId: null, updatedAt: new Date() })
          .where(eq(aiWorkflows.id, workflowId));
      }
      if (generationId) await transaction.delete(aiGenerations).where(eq(aiGenerations.id, generationId));
      if (workflowId) await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
      if (assetId) await transaction.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
      if (leadId) await transaction.delete(leads).where(eq(leads.id, leadId));
    });
  }
});

test('PostgreSQL administrator retry preparation reaches a failed staff-owned Mini Program task', async () => {
  let generationId: bigint | null = null;
  try {
    const generation = await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).createGeneration({
        enterpriseId: enterpriseAId,
        operatorId: promotionDesignerAId,
        type: 'miniprogram',
        channel: 'miniprogram',
        status: 'failed',
        retryCount: 2,
        externalTask: { status: 'failed', taskId: `${testRunKey}-mini-retry` },
        billing: { price: 8, cycle: 2, status: 'released' },
        errorCode: 'PROVIDER_FAILED',
        errorMessage: 'Provider task failed',
      })
    );
    generationId = generation.id;

    const prepared = await preparePostgresMiniAiTaskRetry(
      generation.id.toString(),
      enterpriseAId.toString()
    );
    assert.equal(prepared.id, generation.id);

    const persisted = await withTenantTransaction(enterpriseAId, (transaction) =>
      new AiCreationRepository(transaction).findGeneration(generation.id)
    );
    assert.equal(persisted?.status, 'pending');
    assert.equal(persisted?.retryCount, 3);
    assert.equal(persisted?.errorCode, null);
    assert.equal(persisted?.errorMessage, null);
    assert.deepEqual(persisted?.externalTask, {});
    assert.equal((persisted?.billing as { cycle?: number; status?: string }).cycle, 3);
    assert.equal((persisted?.billing as { cycle?: number; status?: string }).status, 'unbilled');

    await assert.rejects(
      () => preparePostgresMiniAiTaskRetry(generation.id.toString(), enterpriseBId.toString()),
      /Only failed Mini Program AI tasks/
    );
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (generationId) await transaction.delete(aiGenerations).where(eq(aiGenerations.id, generationId));
    });
  }
});

test('PostgreSQL workflow scenario executions use the provider lifecycle under tenant RLS', async () => {
  let leadId: bigint | null = null;
  let workflowId: bigint | null = null;
  let resultAssetId: bigint | null = null;
  const generationIds: bigint[] = [];
  try {
    const lead = await withTenantTransaction(enterpriseAId, (transaction) =>
      new LeadRepository(transaction).create({
        enterpriseId: enterpriseAId,
        assignedTo: promotionDesignerAId,
        name: 'Scenario provider lifecycle lead',
        phone: `139${String(Date.now()).slice(-8)}`,
        source: 'integration-test',
        status: 'new',
      })
    );
    leadId = lead.id;
    const workflow = await createPostgresAiWorkflow({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      leadId: lead.id,
      sourceImage: 'data:image/png;base64,AA==',
    });
    workflowId = workflow.id;
    await withTenantTransaction(enterpriseAId, (transaction) =>
      new EnterpriseRepository(transaction).update(enterpriseAId, {
        aiPolicy: { enabledActionKeys: ['image.free_create', 'image.scenario'] },
      })
    );

    const prepareScenario = () => preparePostgresAiWorkflowStage({
      enterpriseId: enterpriseAId,
      operatorId: promotionDesignerAId,
      workflowId: workflow.id,
      stageKey: 'direction',
    });
    const fundAndHold = async (generationId: bigint, operationSuffix: string) => {
      const generation = await withTenantTransaction(enterpriseAId, (transaction) =>
        new AiCreationRepository(transaction).findGeneration(generationId)
      );
      assert.ok(generation);
      const grant = await grantAiCredits({
        enterpriseId: enterpriseAId.toString(),
        operatorId: promotionDesignerAId.toString(),
        amount: Number((generation!.billing as { price?: number }).price),
        operationId: `${testRunKey}:scenario-${operationSuffix}-grant`,
      });
      aiCreditLedgerIds.push(grant.ledger.id);
      const held = await holdPostgresCreationGenerationCredits({
        enterpriseId: enterpriseAId.toString(),
        generationId: generationId.toString(),
      });
      assert.equal(held.generation.status, 'created');
      assert.equal((held.generation.billing as { status?: string }).status, 'held');
      if (held.ledger) aiCreditLedgerIds.push(held.ledger.id);
      return held;
    };

    const succeededScenario = await prepareScenario();
    generationIds.push(succeededScenario.id);
    await fundAndHold(succeededScenario.id, 'success');
    const succeededAttempt = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: succeededScenario.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'scenario-integration-provider',
      adapterType: 'grs',
      remoteModel: 'scenario-integration-model',
      requestSnapshot: { prompt: 'Scenario execution integration test' },
    });
    assert.equal(succeededAttempt.reused, false);
    assert.equal(succeededAttempt.attempt.resolutionTier, null);
    assert.equal((succeededAttempt.attempt.metadata as { stageKey?: string }).stageKey, 'direction');

    await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: succeededScenario.id.toString(),
      attemptId: succeededAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-scenario-success`,
      remoteStatus: 'queued',
    });
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const creation = new AiCreationRepository(transaction);
      const generation = await creation.findGeneration(succeededScenario.id);
      assert.ok(generation);
      const updated = await creation.updateGeneration(succeededScenario.id, {
        externalTask: {
          ...(generation!.externalTask as Record<string, unknown>),
          nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        },
      });
      assert.ok(updated);
    });
    const scenarioClaims = await claimPostgresCreationProviderPolls({
      enterpriseId: enterpriseAId.toString(),
      limit: 10,
      leaseMs: 30_000,
    });
    const scenarioClaim = scenarioClaims.find(
      (claim) => claim.generationId === succeededScenario.id.toString()
    );
    assert.ok(scenarioClaim);
    const polled = await recordPostgresCreationProviderPollState({
      enterpriseId: enterpriseAId.toString(),
      generationId: succeededScenario.id.toString(),
      attemptId: succeededAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-scenario-success`,
      status: 'processing',
      remoteStatus: 'running',
      pollLeaseId: scenarioClaim!.pollLeaseId,
    });
    assert.equal((polled.generation.externalTask as { pollLeaseId?: string }).pollLeaseId, undefined);

    const completed = await completePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: succeededScenario.id.toString(),
      attemptId: succeededAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-scenario-success`,
      output: { imageUrl: 'https://provider.example/scenario-success.png' },
    });
    assert.equal(completed.generation.status, 'succeeded');
    await withTenantTransaction(enterpriseAId, async (transaction) => {
      const asset = await new AiCreationRepository(transaction).createMediaAsset({
        enterpriseId: enterpriseAId,
        ownerType: 'ai_generation_output',
        ownerId: null,
        mimeType: 'image/png',
        size: 4n,
        width: 1,
        height: 1,
        storageProvider: 'local',
        storageKey: `${testRunKey}/scenario-success.png`,
        originalUrl: 'https://provider.example/scenario-success.png',
      });
      resultAssetId = asset.id;
    });
    const settled = await settlePostgresCreationProviderResult({
      enterpriseId: enterpriseAId.toString(),
      generationId: succeededScenario.id.toString(),
      attemptId: succeededAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-scenario-success`,
      assetId: resultAssetId!.toString(),
    });
    assert.equal((settled.generation.billing as { status?: string }).status, 'consumed');
    assert.equal(settled.asset.ownerId, succeededScenario.id);
    assert.equal(settled.workflow?.lastGenerationId, succeededScenario.id);
    assert.equal(settled.workflow?.currentStageKey, 'base_render');
    if (settled.ledger) aiCreditLedgerIds.push(settled.ledger.id);

    const failedScenario = await prepareScenario();
    generationIds.push(failedScenario.id);
    await fundAndHold(failedScenario.id, 'failure');
    const failedAttempt = await beginPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: failedScenario.id.toString(),
      providerConfigId: aiProviderConfigId.toString(),
      providerKey: 'scenario-integration-provider',
      adapterType: 'grs',
      remoteModel: 'scenario-integration-model',
      requestSnapshot: { prompt: 'Scenario failure integration test' },
    });
    await acknowledgePostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: failedScenario.id.toString(),
      attemptId: failedAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-scenario-failure`,
    });
    const failed = await failPostgresCreationProviderAttempt({
      enterpriseId: enterpriseAId.toString(),
      generationId: failedScenario.id.toString(),
      attemptId: failedAttempt.attempt.id.toString(),
      remoteTaskId: `${testRunKey}-scenario-failure`,
      errorMessage: 'Scenario provider failure integration test',
    });
    assert.equal(failed.generation.status, 'failed');
    assert.equal((failed.generation.billing as { status?: string }).status, 'released');
    if (failed.ledger) aiCreditLedgerIds.push(failed.ledger.id);

    const cancelledScenario = await prepareScenario();
    generationIds.push(cancelledScenario.id);
    await fundAndHold(cancelledScenario.id, 'cancelled');
    const cancelled = await releasePostgresCreationGenerationCredits({
      enterpriseId: enterpriseAId.toString(),
      generationId: cancelledScenario.id.toString(),
      errorMessage: 'Scenario submission was intentionally skipped',
    });
    assert.equal(cancelled.generation.status, 'failed');
    assert.equal((cancelled.generation.billing as { status?: string }).status, 'released');
    if (cancelled.ledger) aiCreditLedgerIds.push(cancelled.ledger.id);
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (generationIds.length) {
        await transaction.delete(aiGenerations).where(inArray(aiGenerations.id, generationIds));
      }
      if (resultAssetId) {
        await transaction.delete(mediaAssets).where(eq(mediaAssets.id, resultAssetId));
      }
      if (workflowId) {
        await transaction.delete(aiWorkflows).where(eq(aiWorkflows.id, workflowId));
      }
      if (leadId) await transaction.delete(leads).where(eq(leads.id, leadId));
    });
  }
});

test('media storage list ordering has a matching composite index', async () => {
  const result = await getPostgresPool().query<{ definition: string }>(`
    select indexdef as definition
    from pg_indexes
    where schemaname = 'app'
      and indexname = 'media_storage_configs_status_created_idx'
  `);
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].definition, /\(status, created_at\)/);
});

test('AI provider due-poll claims have a matching partial index', async () => {
  const result = await getPostgresPool().query<{ definition: string }>(`
    select indexdef as definition
    from pg_indexes
    where schemaname = 'app'
      and indexname = 'ai_generations_due_provider_poll_idx'
  `);
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].definition, /external_task/);
  assert.match(result.rows[0].definition, /nextPollAt/);
  assert.match(result.rows[0].definition, /status.*processing/);
  assert.match(result.rows[0].definition, /current_attempt_id.*IS NOT NULL/);
});

test('every tenant foreign key and RLS predicate column has an index', async () => {
  const missingForeignKeyIndexes = await getPostgresPool().query<{
    table_name: string;
    column_name: string;
  }>(`
    select
      c.conrelid::regclass::text as table_name,
      a.attname as column_name
    from pg_constraint c
    cross join lateral unnest(c.conkey) as key(attnum)
    join pg_attribute a
      on a.attrelid = c.conrelid
      and a.attnum = key.attnum
    where c.contype = 'f'
      and c.connamespace = 'app'::regnamespace
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and key.attnum = any(i.indkey)
      )
  `);
  assert.deepEqual(missingForeignKeyIndexes.rows, []);
});

test('surveying core repositories preserve bigint relations and tenant isolation', async () => {
  let adminUserId: bigint | null = null;
  let secondaryAdminUserId: bigint | null = null;
  let userId: bigint | null = null;
  let leadId: bigint | null = null;
  let floorPlanId: bigint | null = null;
  let deviceId: bigint | null = null;

  try {
    const created = await withTenantTransaction(
      enterpriseAId,
      async (transaction) => {
        const admin = await new AdminUserRepository(transaction).create({
          enterpriseId: enterpriseAId,
          username: `${testRunKey}-surveyor`,
          passwordHash: 'integration-test-only',
          displayName: 'Integration Surveyor',
          role: 'measurer',
          phone: `139${String(Date.now()).slice(-8)}`,
        });
        const user = await new UserRepository(transaction).create({
          enterpriseId: enterpriseAId,
          role: 'user',
          openid: `${testRunKey}-survey-user`,
          nickname: 'Survey Customer',
          phone: `138${String(Date.now() + 1).slice(-8)}`,
        });
        const secondaryAdmin = await new AdminUserRepository(
          transaction
        ).create({
          enterpriseId: enterpriseAId,
          username: `${testRunKey}-second-surveyor`,
          passwordHash: 'integration-test-only',
          displayName: 'Second Integration Surveyor',
          role: 'measurer',
          phone: `136${String(Date.now() + 3).slice(-8)}`,
        });
        const plan = await new FloorPlanRepository(transaction).create({
          enterpriseId: enterpriseAId,
          creatorId: user.id,
          staffId: admin.id,
          name: 'Formal integration plan',
          layoutData: {
            version: 4,
            measurementMode: 'surveying',
            surveyGraph: {
              kind: 'survey-wall-graph',
              activeFloorId: 'floor-1',
              floors: [{ id: 'floor-1', nodes: [], walls: [], spaces: [] }],
            },
          },
          source: 'manual',
          status: 'completed',
          completedAt: new Date(),
        });
        assert.ok(plan);
        const leadRepository = new LeadRepository(transaction);
        const lead = await leadRepository.create({
          enterpriseId: enterpriseAId,
          assignedTo: admin.id,
          name: 'Survey integration lead',
          phone: `137${String(Date.now() + 2).slice(-8)}`,
          source: 'integration-test',
          status: 'new',
        });
        const linkedLead = await leadRepository.linkFloorPlan(
          lead.id,
          plan.id
        );
        assert.equal(linkedLead?.primaryFloorPlanId, plan.id);
        assert.deepEqual(
          linkedLead?.floorPlanRecords.map((item) => item.id),
          [plan.id]
        );
        const measurement = await new MeasurementRepository(
          transaction
        ).create({
          enterpriseId: enterpriseAId,
          floorPlanId: plan.id,
          operatorId: admin.id,
          value: '2450',
          unit: 'millimeters',
          type: 'length',
          source: 'ble',
          measuredAt: new Date(),
        });
        assert.equal(measurement?.operator?.id, admin.id);
        const device = await new DeviceRepository(transaction).create({
          enterpriseId: enterpriseAId,
          assignedUserId: admin.id,
          code: `${testRunKey}-laser`,
          status: 'assigned',
        });
        assert.equal(device?.assignedUser?.id, admin.id);
        const sharedDevice = await new DeviceRepository(transaction).update(
          device!.id,
          {
            enterpriseId: enterpriseAId,
            assignedUserId: admin.id,
            status: 'assigned',
          },
          [admin.id, secondaryAdmin.id]
        );
        assert.deepEqual(
          sharedDevice?.assignedUsers
            .map((assignedUser) => assignedUser.id.toString())
            .sort(),
          [admin.id.toString(), secondaryAdmin.id.toString()].sort()
        );
        assert.equal(
          (
            await new DeviceRepository(transaction).findLatestAssignedToUser(
              secondaryAdmin.id
            )
          )?.id,
          device!.id
        );
        return { admin, secondaryAdmin, user, lead, plan, device };
      }
    );

    adminUserId = created.admin.id;
    secondaryAdminUserId = created.secondaryAdmin.id;
    userId = created.user.id;
    leadId = created.lead.id;
    floorPlanId = created.plan.id;
    deviceId = created.device!.id;

    const tenantBVisibility = await withTenantTransaction(
      enterpriseBId,
      async (transaction) => ({
        lead: await new LeadRepository(transaction).findById(leadId!),
        plan: await new FloorPlanRepository(transaction).findById(floorPlanId!),
        device: await new DeviceRepository(transaction).findById(deviceId!),
      })
    );
    assert.deepEqual(tenantBVisibility, {
      lead: null,
      plan: null,
      device: null,
    });
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (deviceId) {
        await transaction.delete(devices).where(eq(devices.id, deviceId));
      }
      if (leadId) {
        await transaction.delete(leads).where(eq(leads.id, leadId));
      }
      if (floorPlanId) {
        await transaction
          .delete(floorPlans)
          .where(eq(floorPlans.id, floorPlanId));
      }
      if (adminUserId) {
        await transaction
          .delete(adminUsers)
          .where(eq(adminUsers.id, adminUserId));
      }
      if (secondaryAdminUserId) {
        await transaction
          .delete(adminUsers)
          .where(eq(adminUsers.id, secondaryAdminUserId));
      }
      if (userId) {
        await transaction.delete(users).where(eq(users.id, userId));
      }
    });
  }
});

test('commercial activation atomically binds the selected order to its promotion record', async () => {
  let recordId: bigint | null = null;
  let selectedOrderId: bigint | null = null;
  let unselectedOrderId: bigint | null = null;
  let enterpriseId: bigint | null = null;

  try {
    const activated = await withPlatformTransaction(async (transaction) => {
      const records = new PromotionRecordRepository(transaction);
      const commercial = new CommercialRepository(transaction);
      const record = await records.create({
        enterpriseName: `${testRunKey} Activation`,
        creditCode: `${testRunKey}-activation`,
        contactPerson: 'Activation Contact',
        phone: `136${String(Date.now()).slice(-8)}`,
        sourceChannel: 'integration-test',
        ownershipStatus: 'unassigned',
        businessStage: 'reported',
        pendingActionRole: 'salesperson',
        poolStatus: 'in_pool',
      });
      const selectedOrder = await commercial.createOrder({
        recordId: record.id,
        enterpriseId: null,
        enterpriseNameSnapshot: record.enterpriseName,
        packageName: 'Activation selected order',
        amount: '100',
        status: 'draft',
      });
      const unselectedOrder = await commercial.createOrder({
        recordId: record.id,
        enterpriseId: null,
        enterpriseNameSnapshot: record.enterpriseName,
        packageName: 'Activation unselected order',
        amount: '200',
        status: 'draft',
      });
      const enterprise = await new EnterpriseRepository(transaction).create({
        name: `${testRunKey} Activation Enterprise`,
        code: `${testRunKey}-activation-enterprise`,
        status: 'active',
        registrationMode: 'manual',
        contactPerson: { name: record.contactPerson, phone: record.phone },
      });

      assert.equal(
        await commercial.activateRecord(record.id, enterprise.id, selectedOrder.id),
        true
      );
      return { record, selectedOrder, unselectedOrder, enterprise };
    });
    recordId = activated.record.id;
    selectedOrderId = activated.selectedOrder.id;
    unselectedOrderId = activated.unselectedOrder.id;
    enterpriseId = activated.enterprise.id;

    const persisted = await withPlatformTransaction(async (transaction) => ({
      record: await new PromotionRecordRepository(transaction).findById(recordId!),
      selectedOrder: await new CommercialRepository(transaction).findOrderById(selectedOrderId!),
      unselectedOrder: await new CommercialRepository(transaction).findOrderById(unselectedOrderId!),
    }));
    assert.equal(persisted.record?.enterpriseId, enterpriseId);
    assert.equal(persisted.record?.businessStage, 'paid');
    assert.equal(persisted.record?.pendingActionRole, 'none');
    assert.equal(persisted.selectedOrder?.enterpriseId, enterpriseId);
    assert.equal(persisted.unselectedOrder?.enterpriseId, null);
  } finally {
    await withPlatformTransaction(async (transaction) => {
      if (selectedOrderId) {
        await transaction.delete(enterpriseOrders).where(eq(enterpriseOrders.id, selectedOrderId));
      }
      if (unselectedOrderId) {
        await transaction.delete(enterpriseOrders).where(eq(enterpriseOrders.id, unselectedOrderId));
      }
      if (recordId) {
        await transaction
          .delete(promotionEnterpriseRecords)
          .where(eq(promotionEnterpriseRecords.id, recordId));
      }
      if (enterpriseId) {
        await transaction.delete(enterprises).where(eq(enterprises.id, enterpriseId));
      }
    });
  }
});

test('formal floor plans require the version-4 surveying contract', async () => {
  const result = await getPostgresPool().query<{
    column_default: string | null;
    definition: string;
  }>(`
    select
      columns.column_default,
      pg_get_constraintdef(constraints.oid) as definition
    from information_schema.columns columns
    join pg_constraint constraints
      on constraints.conrelid = 'app.floor_plans'::regclass
      and constraints.conname = 'floor_plans_formal_layout_check'
    where columns.table_schema = 'app'
      and columns.table_name = 'floor_plans'
      and columns.column_name = 'layout_data'
  `);
  assert.equal(result.rows[0].column_default, null);
  assert.match(result.rows[0].definition, /version/);
  assert.match(result.rows[0].definition, /measurementMode/);
  assert.match(result.rows[0].definition, /surveyGraph/);
});

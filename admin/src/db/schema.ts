import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

const id = () =>
  bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow();
const jsonObject = <T extends Record<string, unknown>>(name: string) =>
  jsonb(name).$type<T>().notNull().default(sql`'{}'::jsonb`);
const textArray = (name: string) =>
  text(name).array().notNull().default(sql`'{}'::text[]`);

export const migrationCheckpoints = appSchema.table('migration_checkpoints', {
  key: text('key').primaryKey(),
  phase: text('phase').notNull(),
  status: text('status').notNull(),
  details: jsonObject<Record<string, unknown>>('details'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const enterprises = appSchema.table(
  'enterprises',
  {
    id: id(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    status: text('status').notNull().default('pending_approval'),
    registrationMode: text('registration_mode').notNull().default('manual'),
    contactPerson: jsonObject<Record<string, unknown>>('contact_person'),
    address: text('address'),
    industry: text('industry'),
    description: text('description'),
    logo: text('logo'),
    branding: jsonObject<Record<string, unknown>>('branding'),
    groundPromotionFixedCommission: numeric(
      'ground_promotion_fixed_commission',
      { precision: 14, scale: 2 }
    )
      .notNull()
      .default('0'),
    measurerAcquisitionFixedCommission: numeric(
      'measurer_acquisition_fixed_commission',
      { precision: 14, scale: 2 }
    )
      .notNull()
      .default('0'),
    automationConfig: jsonObject<Record<string, unknown>>('automation_config'),
    aiConfig: jsonObject<Record<string, unknown>>('ai_config'),
    aiPolicy: jsonObject<Record<string, unknown>>('ai_policy'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('enterprises_code_uidx').on(table.code),
    index('enterprises_status_created_idx').on(table.status, table.createdAt),
  ]
);

export const systemRoles = appSchema.table(
  'system_roles',
  {
    id: id(),
    roleKey: text('role_key').notNull(),
    label: text('label').notNull(),
    menuKeys: textArray('menu_keys'),
    description: text('description').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('system_roles_role_key_uidx').on(table.roleKey)]
);

export const departments = appSchema.table(
  'departments',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    parentId: bigint('parent_id', { mode: 'bigint' }),
    name: text('name').notNull(),
    order: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('departments_enterprise_parent_idx').on(
      table.enterpriseId,
      table.parentId
    ),
  ]
);

export const adminUsers = appSchema.table(
  'admin_users',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'restrict' }
    ),
    departmentId: bigint('department_id', { mode: 'bigint' }).references(
      () => departments.id,
      { onDelete: 'set null' }
    ),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull().default(''),
    role: text('role').notNull().default('admin'),
    wecomUserId: text('wecom_user_id'),
    wechatId: text('wechat_id'),
    wechatQrAssetId: bigint('wechat_qr_asset_id', { mode: 'bigint' }).references(
      () => mediaAssets.id,
      { onDelete: 'set null' }
    ),
    openid: text('openid'),
    phone: text('phone'),
    menuPermissions: textArray('menu_permissions'),
    status: text('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('admin_users_username_uidx').on(table.username),
    uniqueIndex('admin_users_phone_uidx')
      .on(table.phone)
      .where(sql`${table.phone} is not null`),
    index('admin_users_enterprise_role_idx').on(table.enterpriseId, table.role),
    index('admin_users_enterprise_department_idx').on(
      table.enterpriseId,
      table.departmentId
    ),
    index('admin_users_wechat_qr_asset_idx').on(table.wechatQrAssetId),
  ]
);

export const enterpriseRoleCapabilities = appSchema.table(
  'enterprise_role_capabilities',
  {
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    roleKey: text('role_key').notNull(),
    capabilityKey: text('capability_key').notNull(),
    allowed: boolean('allowed').notNull().default(false),
    updatedBy: bigint('updated_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'enterprise_role_capabilities_pkey',
      columns: [table.enterpriseId, table.roleKey, table.capabilityKey],
    }),
    index('enterprise_role_capabilities_lookup_idx').on(
      table.enterpriseId,
      table.capabilityKey
    ),
    index('enterprise_role_capabilities_updated_by_idx').on(table.updatedBy),
  ]
);

export const adminUserCapabilityOverrides = appSchema.table(
  'admin_user_capability_overrides',
  {
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    adminUserId: bigint('admin_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    capabilityKey: text('capability_key').notNull(),
    allowed: boolean('allowed').notNull(),
    updatedBy: bigint('updated_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'admin_user_capability_overrides_pkey',
      columns: [table.adminUserId, table.capabilityKey],
    }),
    index('admin_user_capability_overrides_lookup_idx').on(
      table.enterpriseId,
      table.capabilityKey
    ),
    index('admin_user_capability_overrides_updated_by_idx').on(table.updatedBy),
  ]
);

export const adminUserPromoters = appSchema.table(
  'admin_user_promoters',
  {
    adminUserId: bigint('admin_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    promoterId: bigint('promoter_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({
      name: 'admin_user_promoters_pkey',
      columns: [table.adminUserId, table.promoterId],
    }),
    index('admin_user_promoters_promoter_idx').on(table.promoterId),
  ]
);

export const measurerDesignerBindings = appSchema.table(
  'measurer_designer_bindings',
  {
    measurerId: bigint('measurer_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    designerId: bigint('designer_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'measurer_designer_bindings_pkey', columns: [table.measurerId] }),
    index('measurer_designer_bindings_designer_idx').on(table.designerId),
    index('measurer_designer_bindings_enterprise_idx').on(table.enterpriseId),
  ]
);

export const users = appSchema.table(
  'users',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'set null' }
    ),
    username: text('username'),
    passwordHash: text('password_hash'),
    role: text('role').notNull().default('user'),
    openid: text('openid'),
    nickname: text('nickname'),
    avatar: text('avatar'),
    communityName: text('community_name'),
    city: text('city'),
    phone: text('phone'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_username_uidx')
      .on(table.username)
      .where(sql`${table.username} is not null`),
    uniqueIndex('users_openid_uidx')
      .on(table.openid)
      .where(sql`${table.openid} is not null`),
    index('users_enterprise_created_idx').on(
      table.enterpriseId,
      table.createdAt
    ),
    index('users_phone_idx').on(table.phone),
  ]
);

export const platformConfigs = appSchema.table(
  'platform_configs',
  {
    id: id(),
    key: text('key').notNull(),
    mediaStorage: jsonObject<Record<string, unknown>>('media_storage'),
    promotionConfig: jsonObject<Record<string, unknown>>('promotion_config'),
    notificationConfig: jsonObject<Record<string, unknown>>('notification_config'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('platform_configs_key_uidx').on(table.key)]
);

export const mediaStorageConfigs = appSchema.table(
  'media_storage_configs',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    driver: text('driver').notNull(),
    accessKeyEncrypted: text('access_key_encrypted').notNull().default(''),
    accessKeyMasked: text('access_key_masked').notNull().default(''),
    secretKeyEncrypted: text('secret_key_encrypted').notNull().default(''),
    secretKeyMasked: text('secret_key_masked').notNull().default(''),
    bucket: text('bucket').notNull().default(''),
    region: text('region').notNull().default(''),
    domain: text('domain').notNull().default(''),
    objectPrefix: text('object_prefix').notNull().default(''),
    status: text('status').notNull().default('active'),
    lastTestedAt: timestamp('last_tested_at', {
      withTimezone: true,
      mode: 'date',
    }),
    lastTestOk: boolean('last_test_ok'),
    lastTestMessage: text('last_test_message'),
    createdBy: bigint('created_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    updatedBy: bigint('updated_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    archivedAt: timestamp('archived_at', {
      withTimezone: true,
      mode: 'date',
    }),
    archivedBy: bigint('archived_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('media_storage_configs_key_uidx').on(table.key),
    index('media_storage_configs_status_created_idx').on(
      table.status,
      table.createdAt
    ),
    index('media_storage_configs_created_by_idx').on(table.createdBy),
    index('media_storage_configs_updated_by_idx').on(table.updatedBy),
    index('media_storage_configs_archived_by_idx').on(table.archivedBy),
  ]
);

export const aiProviderConfigs = appSchema.table(
  'ai_provider_configs',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    adapterType: text('adapter_type').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    apiKeyMasked: text('api_key_masked').notNull(),
    credentialsEncrypted:
      jsonObject<Record<string, unknown>>('credentials_encrypted'),
    credentialsMasked:
      jsonObject<Record<string, unknown>>('credentials_masked'),
    adapterConfig: jsonObject<Record<string, unknown>>('adapter_config'),
    capabilities: textArray('capabilities'),
    modelMappings: jsonObject<Record<string, unknown>>('model_mappings'),
    priority: integer('priority').notNull().default(100),
    timeoutMs: integer('timeout_ms').notNull().default(120000),
    enabled: boolean('enabled').notNull().default(true),
    costRules: jsonb('cost_rules')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    operationalState: jsonObject<Record<string, unknown>>('operational_state'),
    createdBy: bigint('created_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    updatedBy: bigint('updated_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_provider_configs_key_uidx').on(table.key),
    index('ai_provider_configs_enabled_priority_idx').on(
      table.enabled,
      table.priority
    ),
    index('ai_provider_configs_created_by_idx').on(table.createdBy),
    index('ai_provider_configs_updated_by_idx').on(table.updatedBy),
  ]
);

export const aiCreationModelProfiles = appSchema.table(
  'ai_creation_model_profiles',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sourceModelSourceIds: textArray('source_model_source_ids'),
    sourceType: text('source_type').notNull(),
    adapterType: text('adapter_type'),
    remoteModel: text('remote_model'),
    family: text('family'),
    catalogVersion: text('catalog_version'),
    generateLogicalModelKey: text('generate_logical_model_key').notNull(),
    editLogicalModelKey: text('edit_logical_model_key'),
    capabilities: jsonObject<Record<string, unknown>>('capabilities'),
    defaults: jsonObject<Record<string, unknown>>('defaults'),
    isDefault: boolean('is_default').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    weight: integer('weight').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_creation_model_profiles_key_uidx').on(table.key),
    index('ai_creation_model_profiles_enabled_weight_idx').on(
      table.enabled,
      table.weight
    ),
    uniqueIndex('ai_creation_model_profiles_default_uidx')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
  ]
);

export const aiCreditPrices = appSchema.table(
  'ai_credit_prices',
  {
    id: id(),
    actionKey: text('action_key').notNull(),
    mode: text('mode'),
    label: text('label').notNull(),
    credits: bigint('credits', { mode: 'bigint' }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: bigint('updated_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_credit_prices_action_uidx').on(table.actionKey),
    index('ai_credit_prices_enabled_idx').on(table.enabled),
    index('ai_credit_prices_updated_by_idx').on(table.updatedBy),
  ]
);

export const aiModelCreditPrices = appSchema.table(
  'ai_model_credit_prices',
  {
    id: id(),
    actionKey: text('action_key').notNull().default('image.free_create'),
    modelProfileKey: text('model_profile_key').notNull(),
    resolutionTier: text('resolution_tier').notNull(),
    label: text('label').notNull(),
    credits: bigint('credits', { mode: 'bigint' }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: bigint('updated_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_model_credit_prices_model_resolution_uidx').on(
      table.modelProfileKey,
      table.resolutionTier
    ),
    index('ai_model_credit_prices_enabled_idx').on(table.enabled),
    index('ai_model_credit_prices_updated_by_idx').on(table.updatedBy),
  ]
);

export const packages = appSchema.table(
  'packages',
  {
    id: id(),
    name: text('name').notNull(),
    price: numeric('price', { precision: 14, scale: 2 }).notNull(),
    description: text('description'),
    features: textArray('features'),
    promotionCommission: numeric('promotion_commission', {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default('0'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('packages_name_uidx').on(table.name),
    index('packages_status_created_idx').on(table.status, table.createdAt),
  ]
);

export const aiPromptLibraryRevisions = appSchema.table(
  'ai_prompt_library_revisions',
  {
    id: id(),
    source: text('source').notNull().default('roomi'),
    revisionKey: text('revision_key').notNull(),
    status: text('status').notNull().default('staging'),
    manifestHash: text('manifest_hash').notNull(),
    contentHash: text('content_hash').notNull(),
    snapshotPath: text('snapshot_path'),
    counts: jsonObject<Record<string, unknown>>('counts'),
    validationErrors: textArray('validation_errors'),
    validationWarnings: textArray('validation_warnings'),
    publishedAt: timestamp('published_at', {
      withTimezone: true,
      mode: 'date',
    }),
    supersededAt: timestamp('superseded_at', {
      withTimezone: true,
      mode: 'date',
    }),
    rolledBackAt: timestamp('rolled_back_at', {
      withTimezone: true,
      mode: 'date',
    }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_prompt_library_revisions_key_uidx').on(table.revisionKey),
    index('ai_prompt_library_revisions_source_status_published_idx').on(
      table.source,
      table.status,
      table.publishedAt
    ),
    uniqueIndex('ai_prompt_library_revisions_active_uidx')
      .on(table.source)
      .where(sql`${table.status} = 'active'`),
  ]
);

export const aiPromptCategories = appSchema.table(
  'ai_prompt_categories',
  {
    id: id(),
    importRevisionId: bigint('import_revision_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiPromptLibraryRevisions.id, { onDelete: 'cascade' }),
    parentCategoryId: bigint('parent_category_id', { mode: 'bigint' }),
    source: text('source').notNull().default('roomi'),
    sourceId: text('source_id').notNull(),
    parentSourceId: text('parent_source_id'),
    sourcePayload: jsonObject<Record<string, unknown>>('source_payload'),
    sourceHash: text('source_hash').notNull(),
    importedAt: timestamp('imported_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    level: integer('level').notNull(),
    name: text('name').notNull(),
    weight: integer('weight').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_prompt_categories_source_revision_uidx').on(
      table.source,
      table.sourceId,
      table.importRevisionId
    ),
    index('ai_prompt_categories_revision_parent_weight_idx').on(
      table.importRevisionId,
      table.parentSourceId,
      table.weight
    ),
    index('ai_prompt_categories_parent_category_idx').on(
      table.parentCategoryId
    ),
  ]
);

export const aiPromptParameterTemplates = appSchema.table(
  'ai_prompt_parameter_templates',
  {
    id: id(),
    importRevisionId: bigint('import_revision_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiPromptLibraryRevisions.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('roomi'),
    sourceId: text('source_id').notNull(),
    sourcePayload: jsonObject<Record<string, unknown>>('source_payload'),
    sourceHash: text('source_hash').notNull(),
    importedAt: timestamp('imported_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    name: text('name').notNull(),
    adaptationModel: textArray('adaptation_model'),
    parameters: jsonObject<Record<string, unknown>>('parameters'),
    weight: integer('weight').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_prompt_parameter_templates_source_revision_uidx').on(
      table.source,
      table.sourceId,
      table.importRevisionId
    ),
  ]
);

export const aiPromptSourceModels = appSchema.table(
  'ai_prompt_source_models',
  {
    id: id(),
    importRevisionId: bigint('import_revision_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiPromptLibraryRevisions.id, { onDelete: 'cascade' }),
    localModelProfileId: bigint('local_model_profile_id', {
      mode: 'bigint',
    }).references(() => aiCreationModelProfiles.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('roomi'),
    sourceId: text('source_id').notNull(),
    sourcePayload: jsonObject<Record<string, unknown>>('source_payload'),
    sourceHash: text('source_hash').notNull(),
    importedAt: timestamp('imported_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    name: text('name').notNull(),
    modelCode: text('model_code'),
    capabilities: jsonObject<Record<string, unknown>>('capabilities'),
    weight: integer('weight').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_prompt_source_models_source_revision_uidx').on(
      table.source,
      table.sourceId,
      table.importRevisionId
    ),
    index('ai_prompt_source_models_profile_idx').on(table.localModelProfileId),
  ]
);

export const aiPromptTemplateAssets = appSchema.table(
  'ai_prompt_template_assets',
  {
    id: id(),
    importRevisionId: bigint('import_revision_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiPromptLibraryRevisions.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('roomi'),
    sourceId: text('source_id').notNull(),
    templateSourceId: text('template_source_id').notNull(),
    sourcePayload: jsonObject<Record<string, unknown>>('source_payload'),
    sourceHash: text('source_hash').notNull(),
    importedAt: timestamp('imported_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    sourceUrl: text('source_url'),
    mimeType: text('mime_type').notNull(),
    size: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    storageProvider: text('storage_provider').notNull(),
    storageKey: text('storage_key').notNull(),
    storageBucket: text('storage_bucket'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_prompt_template_assets_source_revision_uidx').on(
      table.source,
      table.sourceId,
      table.importRevisionId
    ),
    uniqueIndex('ai_prompt_template_assets_storage_key_uidx').on(
      table.storageProvider,
      table.storageKey
    ),
  ]
);

export const aiPromptTemplates = appSchema.table(
  'ai_prompt_templates',
  {
    id: id(),
    importRevisionId: bigint('import_revision_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiPromptLibraryRevisions.id, { onDelete: 'cascade' }),
    categoryId: bigint('category_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiPromptCategories.id, { onDelete: 'restrict' }),
    sourceModelId: bigint('source_model_id', { mode: 'bigint' }).references(
      () => aiPromptSourceModels.id,
      { onDelete: 'set null' }
    ),
    parameterTemplateId: bigint('parameter_template_id', {
      mode: 'bigint',
    }).references(() => aiPromptParameterTemplates.id, { onDelete: 'set null' }),
    previewAssetId: bigint('preview_asset_id', { mode: 'bigint' }).references(
      () => aiPromptTemplateAssets.id,
      { onDelete: 'set null' }
    ),
    source: text('source').notNull().default('roomi'),
    sourceId: text('source_id').notNull(),
    sourcePayload: jsonObject<Record<string, unknown>>('source_payload'),
    sourceHash: text('source_hash').notNull(),
    importedAt: timestamp('imported_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    name: text('name').notNull(),
    promptContent: text('prompt_content').notNull(),
    categorySourceId: text('category_source_id').notNull(),
    bestModelSourceId: text('best_model_source_id'),
    parameterTemplateSourceId: text('parameter_template_source_id'),
    adaptationModel: textArray('adaptation_model'),
    weight: integer('weight').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_prompt_templates_source_revision_uidx').on(
      table.source,
      table.sourceId,
      table.importRevisionId
    ),
    index('ai_prompt_templates_revision_category_enabled_weight_idx').on(
      table.importRevisionId,
      table.categoryId,
      table.enabled,
      table.weight
    ),
    index('ai_prompt_templates_source_model_idx').on(table.sourceModelId),
    index('ai_prompt_templates_parameter_template_idx').on(
      table.parameterTemplateId
    ),
    index('ai_prompt_templates_preview_asset_idx').on(table.previewAssetId),
  ]
);

export const aiPromptImportRuns = appSchema.table(
  'ai_prompt_import_runs',
  {
    id: id(),
    revisionId: bigint('revision_id', { mode: 'bigint' }).references(
      () => aiPromptLibraryRevisions.id,
      { onDelete: 'set null' }
    ),
    source: text('source').notNull().default('roomi'),
    mode: text('mode').notNull(),
    execute: boolean('execute').notNull().default(false),
    status: text('status').notNull(),
    sourceFile: text('source_file'),
    authorization: jsonObject<Record<string, unknown>>('authorization'),
    statistics: jsonObject<Record<string, unknown>>('statistics'),
    errorMessages: textArray('error_messages'),
    startedAt: timestamp('started_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ai_prompt_import_runs_status_started_idx').on(
      table.status,
      table.startedAt
    ),
    index('ai_prompt_import_runs_revision_idx').on(table.revisionId),
  ]
);

export const promotionEnterpriseRecords = appSchema.table(
  'promotion_enterprise_records',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'set null' }
    ),
    promoterId: bigint('promoter_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    enterpriseName: text('enterprise_name').notNull(),
    creditCode: text('credit_code'),
    contactPerson: text('contact_person').notNull(),
    phone: text('phone').notNull(),
    city: text('city'),
    address: text('address'),
    industry: text('industry'),
    sourceChannel: text('source_channel').notNull().default('ground_promotion'),
    ownershipStatus: text('ownership_status').notNull(),
    businessStage: text('business_stage').notNull(),
    pendingActionRole: text('pending_action_role'),
    poolStatus: text('pool_status').notNull(),
    protectionExpiresAt: timestamp('protection_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    protectionExtendedCount: integer('protection_extended_count')
      .notNull()
      .default(0),
    notes: text('notes'),
    nextFollowUpAt: timestamp('next_follow_up_at', {
      withTimezone: true,
      mode: 'date',
    }),
    lastActivityAt: timestamp('last_activity_at', {
      withTimezone: true,
      mode: 'date',
    }),
    claimStatus: text('claim_status'),
    claimRequestedBy: bigint('claim_requested_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    claimRequestedAt: timestamp('claim_requested_at', {
      withTimezone: true,
      mode: 'date',
    }),
    claimReviewedBy: bigint('claim_reviewed_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    claimReviewedAt: timestamp('claim_reviewed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    claimRejectReason: text('claim_reject_reason'),
    measureTaskStatus: text('measure_task_status')
      .notNull()
      .default('unassigned'),
    measureAssignedTo: bigint('measure_assigned_to', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    measureAssignedAt: timestamp('measure_assigned_at', {
      withTimezone: true,
      mode: 'date',
    }),
    measureAcceptedAt: timestamp('measure_accepted_at', {
      withTimezone: true,
      mode: 'date',
    }),
    measureSubmittedAt: timestamp('measure_submitted_at', {
      withTimezone: true,
      mode: 'date',
    }),
    measureDueAt: timestamp('measure_due_at', {
      withTimezone: true,
      mode: 'date',
    }),
    measureLastReminderAt: timestamp('measure_last_reminder_at', {
      withTimezone: true,
      mode: 'date',
    }),
    measureResultSummary: text('measure_result_summary'),
    designTaskStatus: text('design_task_status')
      .notNull()
      .default('unassigned'),
    designAssignedTo: bigint('design_assigned_to', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    designAssignedAt: timestamp('design_assigned_at', {
      withTimezone: true,
      mode: 'date',
    }),
    designCompletedAt: timestamp('design_completed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    designDueAt: timestamp('design_due_at', {
      withTimezone: true,
      mode: 'date',
    }),
    designLastReminderAt: timestamp('design_last_reminder_at', {
      withTimezone: true,
      mode: 'date',
    }),
    designLatestNote: text('design_latest_note'),
    conflictReason: text('conflict_reason'),
    conflictingRecordIds: bigint('conflicting_record_ids', { mode: 'bigint' })
      .array()
      .notNull()
      .default(sql`'{}'::bigint[]`),
    conflictReviewedBy: bigint('conflict_reviewed_by', {
      mode: 'bigint',
    }).references(() => adminUsers.id, { onDelete: 'set null' }),
    conflictReviewedAt: timestamp('conflict_reviewed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    conflictResolution: text('conflict_resolution'),
    workflowState: jsonObject<Record<string, unknown>>('workflow_state'),
    followUpRecords: jsonb('follow_up_records')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    attachments: textArray('attachments'),
    location: jsonObject<Record<string, unknown>>('location'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('promotion_records_enterprise_stage_idx').on(
      table.enterpriseId,
      table.businessStage
    ),
    index('promotion_records_promoter_updated_idx').on(
      table.promoterId,
      table.updatedAt
    ),
    index('promotion_records_measure_assignee_created_idx').on(
      table.measureAssignedTo,
      table.createdAt
    ),
    index('promotion_records_design_assignee_created_idx').on(
      table.designAssignedTo,
      table.createdAt
    ),
    index('promotion_records_claim_request_idx')
      .on(table.claimRequestedBy, table.claimRequestedAt)
      .where(sql`${table.claimStatus} = 'pending'`),
    index('promotion_records_claim_reviewer_idx').on(table.claimReviewedBy),
    index('promotion_records_conflict_reviewer_idx').on(
      table.conflictReviewedBy
    ),
    index('promotion_records_ownership_stage_idx').on(
      table.ownershipStatus,
      table.businessStage
    ),
    index('promotion_records_pending_followup_idx').on(
      table.pendingActionRole,
      table.nextFollowUpAt
    ),
    index('promotion_records_credit_code_idx').on(table.creditCode),
    index('promotion_records_name_phone_idx').on(
      table.enterpriseName,
      table.phone
    ),
    index('promotion_records_pool_followup_idx')
      .on(table.poolStatus, table.nextFollowUpAt)
      .where(sql`${table.poolStatus} <> 'closed'`),
  ]
);

export const leads = appSchema.table(
  'leads',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'restrict' }
    ),
    promoterId: bigint('promoter_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    assignedTo: bigint('assigned_to', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    communityName: text('community_name'),
    area: numeric('area', { precision: 12, scale: 2 }),
    stylePreference: text('style_preference'),
    city: text('city'),
    source: text('source').notNull(),
    status: text('status').notNull().default('new'),
    convertedOn: date('converted_on', { mode: 'string' }),
    convertedAt: timestamp('converted_at', { withTimezone: true, mode: 'date' }),
    convertedBy: bigint('converted_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    convertedFromStatus: text('converted_from_status'),
    contractAmount: numeric('contract_amount', { precision: 14, scale: 2 }),
    conversionNote: text('conversion_note'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true, mode: 'date' }),
    acquiredBy: bigint('acquired_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    archivedBy: bigint('archived_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    archiveReason: text('archive_reason'),
    archiveNote: text('archive_note'),
    notes: text('notes'),
    assignedAt: timestamp('assigned_at', {
      withTimezone: true,
      mode: 'date',
    }),
    primaryFloorPlanId: bigint('primary_floor_plan_id', { mode: 'bigint' }),
    followUpRecords: jsonb('follow_up_records')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('leads_enterprise_status_created_idx').on(
      table.enterpriseId,
      table.status,
      table.createdAt
    ),
    index('leads_enterprise_created_idx').on(
      table.enterpriseId,
      table.createdAt,
      table.id
    ),
    index('leads_enterprise_source_created_idx').on(
      table.enterpriseId,
      table.source,
      table.createdAt
    ),
    index('leads_enterprise_phone_idx').on(
      table.enterpriseId,
      table.phone
    ),
    index('leads_enterprise_assignee_created_idx').on(
      table.enterpriseId,
      table.assignedTo,
      table.createdAt
    ),
    index('leads_assignee_acquired_created_idx').on(
      table.assignedTo,
      table.acquiredAt,
      table.createdAt
    ),
    index('leads_promoter_created_idx').on(
      table.promoterId,
      table.createdAt
    ),
    index('leads_promoter_acquired_created_idx').on(
      table.promoterId,
      table.acquiredAt,
      table.createdAt
    ),
    index('leads_acquired_by_idx').on(table.acquiredBy),
    index('leads_converted_by_idx').on(table.convertedBy),
    index('leads_enterprise_converted_at_idx').on(
      table.enterpriseId,
      table.convertedAt,
      table.id
    ),
    index('leads_archived_by_idx').on(table.archivedBy),
    index('leads_enterprise_archived_created_idx').on(
      table.enterpriseId,
      table.archivedAt,
      table.createdAt,
      table.id
    ),
    index('leads_primary_floor_plan_idx').on(table.primaryFloorPlanId),
  ]
);

export const leadLifecycleEvents = appSchema.table(
  'lead_lifecycle_events',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    leadRecordId: bigint('lead_record_id', { mode: 'bigint' }).notNull(),
    actorId: bigint('actor_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    action: text('action').notNull(),
    reason: text('reason'),
    metadata: jsonObject<Record<string, unknown>>('metadata'),
    createdAt: createdAt(),
  },
  (table) => [
    index('lead_lifecycle_events_enterprise_created_idx').on(
      table.enterpriseId,
      table.createdAt,
      table.id
    ),
    index('lead_lifecycle_events_lead_idx').on(
      table.enterpriseId,
      table.leadRecordId,
      table.createdAt
    ),
    index('lead_lifecycle_events_actor_idx').on(table.actorId),
  ]
);

export const leadAcquisitionCommissions = appSchema.table(
  'lead_acquisition_commissions',
  {
    id: id(),
    leadId: bigint('lead_id', { mode: 'bigint' })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    measurerId: bigint('measurer_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    designerId: bigint('designer_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    commissionAmount: numeric('commission_amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('pending_settlement'),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true, mode: 'date' }),
    settledBy: bigint('settled_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('lead_acquisition_commissions_lead_uidx').on(table.leadId),
    index('lead_acquisition_commissions_enterprise_status_idx').on(table.enterpriseId, table.status),
    index('lead_acquisition_commissions_measurer_status_idx').on(table.measurerId, table.status),
    index('lead_acquisition_commissions_designer_idx').on(table.designerId),
    index('lead_acquisition_commissions_settled_by_idx').on(table.settledBy),
  ]
);

export const staffNotifications = appSchema.table(
  'staff_notifications',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'cascade' }
    ),
    recipientStaffId: bigint('recipient_staff_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    leadId: bigint('lead_id', { mode: 'bigint' }).references(
      () => leads.id,
      { onDelete: 'cascade' }
    ),
    notificationType: text('notification_type').notNull(),
    channel: text('channel').notNull().default('in_app'),
    status: text('status').notNull().default('unread'),
    message: text('message'),
    errorMessage: text('error_message'),
    metadata: jsonObject<Record<string, unknown>>('metadata'),
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('staff_notifications_dedupe_uidx').on(table.dedupeKey, table.channel).where(sql`${table.dedupeKey} is not null`),
    index('staff_notifications_recipient_created_idx').on(table.recipientStaffId, table.createdAt),
    index('staff_notifications_lead_idx').on(table.leadId),
    index('staff_notifications_enterprise_idx').on(table.enterpriseId),
  ]
);

export const floorPlans = appSchema.table(
  'floor_plans',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'restrict' }
    ),
    creatorId: bigint('creator_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    staffId: bigint('staff_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    name: text('name').notNull(),
    layoutData: jsonb('layout_data')
      .$type<Record<string, unknown>>()
      .notNull(),
    source: text('source').notNull(),
    externalSource: jsonObject<Record<string, unknown>>('external_source'),
    status: text('status').notNull().default('draft'),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('floor_plans_enterprise_status_updated_idx').on(
      table.enterpriseId,
      table.status,
      table.updatedAt
    ),
    index('floor_plans_enterprise_updated_idx').on(
      table.enterpriseId,
      table.updatedAt,
      table.id
    ),
    index('floor_plans_creator_created_idx').on(
      table.creatorId,
      table.createdAt
    ),
    index('floor_plans_creator_updated_idx').on(
      table.creatorId,
      table.updatedAt,
      table.id
    ),
    index('floor_plans_staff_updated_idx').on(
      table.staffId,
      table.updatedAt,
      table.id
    ),
    index('floor_plans_staff_status_completed_idx').on(
      table.staffId,
      table.status,
      table.completedAt
    ),
    index('floor_plans_external_source_idx').on(
      table.enterpriseId,
      sql`(${table.externalSource} ->> 'provider')`,
      sql`(${table.externalSource} ->> 'externalId')`
    ),
  ]
);

export const leadFloorPlans = appSchema.table(
  'lead_floor_plans',
  {
    leadId: bigint('lead_id', { mode: 'bigint' })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    floorPlanId: bigint('floor_plan_id', { mode: 'bigint' })
      .notNull()
      .references(() => floorPlans.id, { onDelete: 'cascade' }),
    measurementSequence: integer('measurement_sequence').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'lead_floor_plans_pkey',
      columns: [table.leadId, table.floorPlanId],
    }),
    index('lead_floor_plans_floor_plan_idx').on(table.floorPlanId),
    uniqueIndex('lead_floor_plans_lead_measurement_sequence_key').on(
      table.leadId,
      table.measurementSequence
    ),
  ]
);

export const measurements = appSchema.table(
  'measurements',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'restrict' }
    ),
    floorPlanId: bigint('floor_plan_id', { mode: 'bigint' })
      .notNull()
      .references(() => floorPlans.id, { onDelete: 'cascade' }),
    operatorId: bigint('operator_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    roomId: text('room_id'),
    roomName: text('room_name'),
    deviceId: text('device_id'),
    value: numeric('value', { precision: 16, scale: 4 }).notNull(),
    unit: text('unit').notNull(),
    type: text('type').notNull(),
    direction: text('direction'),
    metadata: jsonObject<Record<string, unknown>>('metadata'),
    source: text('source').notNull(),
    measuredAt: timestamp('measured_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('measurements_enterprise_measured_idx').on(
      table.enterpriseId,
      table.measuredAt
    ),
    index('measurements_floor_plan_measured_idx').on(
      table.floorPlanId,
      table.measuredAt
    ),
    index('measurements_operator_measured_idx').on(
      table.operatorId,
      table.measuredAt
    ),
    index('measurements_device_measured_idx').on(
      table.deviceId,
      table.measuredAt
    ),
  ]
);

export const devices = appSchema.table(
  'devices',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'set null' }
    ),
    assignedUserId: bigint('assigned_user_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    code: text('code').notNull(),
    description: text('description'),
    status: text('status').notNull().default('unassigned'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('devices_code_uidx').on(table.code),
    index('devices_enterprise_status_idx').on(table.enterpriseId, table.status),
    index('devices_assigned_user_idx').on(table.assignedUserId),
  ]
);

export const deviceUserBindings = appSchema.table(
  'device_user_bindings',
  {
    deviceId: bigint('device_id', { mode: 'bigint' })
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    adminUserId: bigint('admin_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'cascade' }
    ),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'device_user_bindings_pkey',
      columns: [table.deviceId, table.adminUserId],
    }),
    index('device_user_bindings_admin_user_idx').on(table.adminUserId),
    index('device_user_bindings_enterprise_idx').on(table.enterpriseId),
  ]
);

export const enterpriseOrders = appSchema.table(
  'enterprise_orders',
  {
    id: id(),
    recordId: bigint('record_id', { mode: 'bigint' })
      .notNull()
      .references(() => promotionEnterpriseRecords.id, { onDelete: 'restrict' }),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'restrict' }
    ),
    enterpriseNameSnapshot: text('enterprise_name_snapshot').notNull(),
    packageName: text('package_name').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('CNY'),
    status: text('status').notNull().default('draft'),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    createdBy: bigint('created_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    remark: text('remark'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('enterprise_orders_enterprise_status_created_idx').on(
      table.enterpriseId,
      table.status,
      table.createdAt
    ),
    index('enterprise_orders_record_idx').on(table.recordId),
    index('enterprise_orders_created_by_idx').on(table.createdBy),
  ]
);

export const commissionRecords = appSchema.table(
  'commission_records',
  {
    id: id(),
    recordId: bigint('record_id', { mode: 'bigint' })
      .notNull()
      .references(() => promotionEnterpriseRecords.id, { onDelete: 'restrict' }),
    orderId: bigint('order_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterpriseOrders.id, { onDelete: 'restrict' }),
    promoterId: bigint('promoter_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'restrict' }
    ),
    commissionType: text('commission_type').notNull(),
    commissionAmount: numeric('commission_amount', {
      precision: 14,
      scale: 2,
    }).notNull(),
    status: text('status').notNull().default('pending_settlement'),
    generatedAt: timestamp('generated_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    settledAt: timestamp('settled_at', {
      withTimezone: true,
      mode: 'date',
    }),
    settledBy: bigint('settled_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('commission_records_order_uidx').on(table.orderId),
    index('commission_records_enterprise_status_idx').on(
      table.enterpriseId,
      table.status
    ),
    index('commission_records_promoter_status_idx').on(
      table.promoterId,
      table.status
    ),
    index('commission_records_record_idx').on(table.recordId),
    index('commission_records_settled_by_idx').on(table.settledBy),
  ]
);

export const workflowNotificationLogs = appSchema.table(
  'workflow_notification_logs',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' }).references(
      () => enterprises.id,
      { onDelete: 'restrict' }
    ),
    recordId: bigint('record_id', { mode: 'bigint' })
      .notNull()
      .references(() => promotionEnterpriseRecords.id, { onDelete: 'cascade' }),
    recipientStaffId: bigint('recipient_staff_id', {
      mode: 'bigint',
    }).references(() => adminUsers.id, { onDelete: 'set null' }),
    recipientRole: text('recipient_role').notNull(),
    channel: text('channel').notNull(),
    notificationType: text('notification_type').notNull(),
    status: text('status').notNull(),
    dedupeKey: text('dedupe_key'),
    message: text('message'),
    errorMessage: text('error_message'),
    metadata: jsonObject<Record<string, unknown>>('metadata'),
    isRead: boolean('is_read').notNull().default(false),
    isAlerted: boolean('is_alerted').notNull().default(false),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('workflow_notification_logs_dedupe_uidx')
      .on(table.dedupeKey, table.channel)
      .where(sql`${table.dedupeKey} is not null`),
    index('workflow_notification_logs_enterprise_status_created_idx').on(
      table.enterpriseId,
      table.status,
      table.createdAt
    ),
    index('workflow_notification_logs_record_idx').on(table.recordId),
    index('workflow_notification_logs_recipient_unread_idx')
      .on(table.recipientStaffId, table.createdAt)
      .where(sql`${table.isRead} = false`),
  ]
);

export const mediaAssets = appSchema.table(
  'media_assets',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    ownerType: text('owner_type').notNull(),
    ownerId: bigint('owner_id', { mode: 'bigint' }),
    mimeType: text('mime_type').notNull(),
    size: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    storageProvider: text('storage_provider').notNull().default('local'),
    storageKey: text('storage_key').notNull(),
    storageBucket: text('storage_bucket'),
    checksumSha256: text('checksum_sha256'),
    originalUrl: text('original_url'),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }),
    purgeError: text('purge_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('media_assets_storage_key_uidx').on(
      table.storageProvider,
      table.storageKey
    ),
    index('media_assets_enterprise_owner_created_idx').on(
      table.enterpriseId,
      table.ownerType,
      table.ownerId,
      table.createdAt
    ),
    index('media_assets_pending_purge_idx')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null and ${table.purgedAt} is null`),
  ]
);

export const aiWorkflows = appSchema.table(
  'ai_workflows',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    leadId: bigint('lead_id', { mode: 'bigint' })
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    operatorId: bigint('operator_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    sourceFloorPlanId: bigint('source_floor_plan_id', {
      mode: 'bigint',
    }).references(() => floorPlans.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    workflowLabel: text('workflow_label'),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status').notNull().default('active'),
    sourceImage: text('source_image'),
    sourceAssetRole: text('source_asset_role').notNull(),
    currentStageKey: text('current_stage_key').notNull(),
    selectedGenerationId: bigint('selected_generation_id', { mode: 'bigint' }),
    lastGenerationId: bigint('last_generation_id', { mode: 'bigint' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ai_workflows_enterprise_updated_idx').on(
      table.enterpriseId,
      table.updatedAt
    ),
    index('ai_workflows_operator_updated_idx').on(
      table.operatorId,
      table.updatedAt
    ),
    index('ai_workflows_lead_updated_idx').on(table.leadId, table.updatedAt),
    index('ai_workflows_source_floor_plan_idx').on(table.sourceFloorPlanId),
    index('ai_workflows_selected_generation_idx').on(
      table.selectedGenerationId
    ),
    index('ai_workflows_last_generation_idx').on(table.lastGenerationId),
  ]
);

export const aiCreationTasks = appSchema.table(
  'ai_creation_tasks',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    operatorId: bigint('operator_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    modelProfileId: bigint('model_profile_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiCreationModelProfiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    lastBatchId: bigint('last_batch_id', { mode: 'bigint' }),
    status: text('status').notNull().default('active'),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ai_creation_tasks_enterprise_operator_updated_idx').on(
      table.enterpriseId,
      table.operatorId,
      table.updatedAt
    ),
    index('ai_creation_tasks_active_idx')
      .on(table.enterpriseId, table.updatedAt)
      .where(sql`${table.status} = 'active' and ${table.deletedAt} is null`),
    index('ai_creation_tasks_model_profile_idx').on(table.modelProfileId),
    index('ai_creation_tasks_last_batch_idx').on(table.lastBatchId),
  ]
);

export const aiCreationBatches = appSchema.table(
  'ai_creation_batches',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    operatorId: bigint('operator_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    taskId: bigint('task_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiCreationTasks.id, { onDelete: 'cascade' }),
    modelProfileId: bigint('model_profile_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiCreationModelProfiles.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    prompt: text('prompt').notNull(),
    negativePrompt: text('negative_prompt'),
    modelProfileSnapshot:
      jsonObject<Record<string, unknown>>('model_profile_snapshot'),
    parameterSnapshot:
      jsonObject<Record<string, unknown>>('parameter_snapshot'),
    requestedCount: integer('requested_count').notNull(),
    status: text('status').notNull().default('pending'),
    creditsEstimate: bigint('credits_estimate', { mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_creation_batches_task_sequence_uidx').on(
      table.taskId,
      table.sequence
    ),
    index('ai_creation_batches_enterprise_status_idx').on(
      table.enterpriseId,
      table.status
    ),
    index('ai_creation_batches_model_profile_idx').on(table.modelProfileId),
    index('ai_creation_batches_operator_idx').on(table.operatorId),
  ]
);

export const aiCreationTaskReferenceAssets = appSchema.table(
  'ai_creation_task_reference_assets',
  {
    taskId: bigint('task_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiCreationTasks.id, { onDelete: 'cascade' }),
    assetId: bigint('asset_id', { mode: 'bigint' })
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'ai_creation_task_reference_assets_pkey',
      columns: [table.taskId, table.assetId],
    }),
    uniqueIndex('ai_creation_task_reference_assets_position_uidx').on(
      table.taskId,
      table.position
    ),
    index('ai_creation_task_reference_assets_asset_idx').on(table.assetId),
  ]
);

export const aiCreationBatchReferenceAssets = appSchema.table(
  'ai_creation_batch_reference_assets',
  {
    batchId: bigint('batch_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiCreationBatches.id, { onDelete: 'cascade' }),
    assetId: bigint('asset_id', { mode: 'bigint' })
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'ai_creation_batch_reference_assets_pkey',
      columns: [table.batchId, table.assetId],
    }),
    uniqueIndex('ai_creation_batch_reference_assets_position_uidx').on(
      table.batchId,
      table.position
    ),
    index('ai_creation_batch_reference_assets_asset_idx').on(table.assetId),
  ]
);

export const aiGenerations = appSchema.table(
  'ai_generations',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    operatorId: bigint('operator_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    floorPlanId: bigint('floor_plan_id', { mode: 'bigint' }).references(
      () => floorPlans.id,
      { onDelete: 'set null' }
    ),
    leadId: bigint('lead_id', { mode: 'bigint' }).references(() => leads.id, {
      onDelete: 'set null',
    }),
    workflowId: bigint('workflow_id', { mode: 'bigint' }).references(
      () => aiWorkflows.id,
      { onDelete: 'set null' }
    ),
    parentGenerationId: bigint('parent_generation_id', { mode: 'bigint' }),
    creationTaskId: bigint('creation_task_id', { mode: 'bigint' }).references(
      () => aiCreationTasks.id,
      { onDelete: 'set null' }
    ),
    creationBatchId: bigint('creation_batch_id', { mode: 'bigint' }).references(
      () => aiCreationBatches.id,
      { onDelete: 'set null' }
    ),
    creationModelProfileId: bigint('creation_model_profile_id', {
      mode: 'bigint',
    }).references(() => aiCreationModelProfiles.id, { onDelete: 'set null' }),
    currentAttemptId: bigint('current_attempt_id', { mode: 'bigint' }),
    type: text('type').notNull(),
    channel: text('channel'),
    stageKey: text('stage_key'),
    sourceAssetRole: text('source_asset_role'),
    isSelectedBaseline: boolean('is_selected_baseline').notNull().default(false),
    nextRecommendedStage: text('next_recommended_stage'),
    input: jsonObject<Record<string, unknown>>('input'),
    output: jsonObject<Record<string, unknown>>('output'),
    status: text('status').notNull().default('created'),
    provider: text('provider'),
    capability: text('capability'),
    logicalModelKey: text('logical_model_key'),
    actionKey: text('action_key'),
    externalTask: jsonObject<Record<string, unknown>>('external_task'),
    providerState: jsonObject<Record<string, unknown>>('provider_state'),
    billing: jsonObject<Record<string, unknown>>('billing'),
    errorMessage: text('error_message'),
    errorCode: text('error_code'),
    retryCount: integer('retry_count').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ai_generations_enterprise_status_created_idx').on(
      table.enterpriseId,
      table.status,
      table.createdAt
    ),
    index('ai_generations_enterprise_created_idx').on(
      table.enterpriseId,
      table.createdAt,
      table.id
    ),
    index('ai_generations_enterprise_type_created_idx').on(
      table.enterpriseId,
      table.type,
      table.createdAt,
      table.id
    ),
    index('ai_generations_workflow_created_idx').on(
      table.workflowId,
      table.createdAt
    ),
    index('ai_generations_operator_created_idx').on(
      table.operatorId,
      table.createdAt
    ),
    index('ai_generations_floor_plan_idx').on(table.floorPlanId),
    index('ai_generations_lead_idx').on(table.leadId),
    index('ai_generations_parent_idx').on(table.parentGenerationId),
    index('ai_generations_creation_task_idx').on(table.creationTaskId),
    index('ai_generations_creation_batch_idx').on(table.creationBatchId),
    index('ai_generations_creation_model_profile_idx').on(
      table.creationModelProfileId
    ),
    index('ai_generations_current_attempt_idx').on(table.currentAttemptId),
    index('ai_generations_pending_poll_idx')
      .on(table.updatedAt)
      .where(sql`${table.status} in ('created', 'pending', 'processing')`),
    index('ai_generations_due_provider_poll_idx')
      .on(sql`(${table.externalTask} ->> 'nextPollAt')`, table.id)
      .where(
        sql`${table.status} = 'processing' and ${table.currentAttemptId} is not null and ${table.deletedAt} is null`
      ),
  ]
);

export const aiProviderAttempts = appSchema.table(
  'ai_provider_attempts',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    generationId: bigint('generation_id', { mode: 'bigint' }).references(
      () => aiGenerations.id,
      { onDelete: 'cascade' }
    ),
    providerConfigId: bigint('provider_config_id', { mode: 'bigint' })
      .notNull()
      .references(() => aiProviderConfigs.id, { onDelete: 'restrict' }),
    providerKey: text('provider_key').notNull(),
    adapterType: text('adapter_type').notNull(),
    capability: text('capability').notNull(),
    logicalModelKey: text('logical_model_key').notNull(),
    remoteModel: text('remote_model').notNull(),
    resolutionTier: text('resolution_tier'),
    remoteTaskId: text('remote_task_id'),
    status: text('status').notNull().default('created'),
    accepted: boolean('accepted').notNull().default(false),
    remoteStatus: text('remote_status'),
    estimatedCost: jsonObject<Record<string, unknown>>('estimated_cost'),
    actualCost: jsonObject<Record<string, unknown>>('actual_cost'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    requestFingerprint: text('request_fingerprint'),
    metadata: jsonObject<Record<string, unknown>>('metadata'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ai_provider_attempts_generation_created_idx').on(
      table.generationId,
      table.createdAt
    ),
    index('ai_provider_attempts_status_updated_idx').on(
      table.status,
      table.updatedAt
    ),
    index('ai_provider_attempts_provider_config_idx').on(table.providerConfigId),
    index('ai_provider_attempts_enterprise_idx').on(table.enterpriseId),
  ]
);

export const aiCreditAccounts = appSchema.table(
  'ai_credit_accounts',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    balance: bigint('balance', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    frozenBalance: bigint('frozen_balance', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    version: integer('version').notNull().default(0),
    appliedOperationIds: textArray('applied_operation_ids'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_credit_accounts_enterprise_uidx').on(table.enterpriseId),
  ]
);

export const aiCreditLedgers = appSchema.table(
  'ai_credit_ledgers',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    generationId: bigint('generation_id', { mode: 'bigint' }).references(
      () => aiGenerations.id,
      { onDelete: 'set null' }
    ),
    operatorId: bigint('operator_id', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    operationId: text('operation_id').notNull(),
    type: text('type').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'bigint' }),
    frozenAfter: bigint('frozen_after', { mode: 'bigint' }),
    status: text('status').notNull().default('pending'),
    note: text('note'),
    metadata: jsonObject<Record<string, unknown>>('metadata'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_credit_ledgers_operation_uidx').on(table.operationId),
    index('ai_credit_ledgers_enterprise_created_idx').on(
      table.enterpriseId,
      table.createdAt
    ),
    index('ai_credit_ledgers_generation_created_idx').on(
      table.generationId,
      table.createdAt
    ),
    index('ai_credit_ledgers_operator_idx').on(table.operatorId),
  ]
);

export const aiChatSessions = appSchema.table(
  'ai_chat_sessions',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    adminId: bigint('admin_id', { mode: 'bigint' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('新对话'),
    messages: jsonb('messages')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastMessageAt: timestamp('last_message_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ai_chat_sessions_enterprise_admin_last_idx').on(
      table.enterpriseId,
      table.adminId,
      table.lastMessageAt
    ),
  ]
);

export const aiStylePresets = appSchema.table(
  'ai_style_presets',
  {
    id: id(),
    key: text('key').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default(''),
    previewClassName: text('preview_class_name').notNull().default(''),
    mockImageUrl: text('mock_image_url'),
    promptTemplate: text('prompt_template').notNull(),
    promptTemplateSecondStage: text('prompt_template_second_stage'),
    negativePrompt: text('negative_prompt').notNull().default(''),
    provider: text('provider'),
    image: jsonObject<Record<string, unknown>>('image'),
    workflowCategory: text('workflow_category'),
    workflowStage: text('workflow_stage'),
    sourceAssetRole: text('source_asset_role'),
    nextRecommendedStage: text('next_recommended_stage'),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: bigint('created_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    updatedBy: bigint('updated_by', { mode: 'bigint' }).references(
      () => adminUsers.id,
      { onDelete: 'set null' }
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ai_style_presets_type_key_uidx').on(table.type, table.key),
    index('ai_style_presets_type_enabled_sort_idx').on(
      table.type,
      table.enabled,
      table.sortOrder
    ),
    index('ai_style_presets_created_by_idx').on(table.createdBy),
    index('ai_style_presets_updated_by_idx').on(table.updatedBy),
  ]
);

export const inspirations = appSchema.table(
  'inspirations',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    coverImage: text('cover_image').notNull(),
    renderingImage: text('rendering_image').notNull(),
    style: text('style').notNull(),
    roomType: text('room_type').notNull(),
    layoutData: jsonObject<Record<string, unknown>>('layout_data'),
    isRecommended: boolean('is_recommended').notNull().default(false),
    viewCount: bigint('view_count', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('inspirations_enterprise_recommended_created_idx').on(
      table.enterpriseId,
      table.isRecommended,
      table.createdAt
    ),
  ]
);

export const enterpriseAiUsageSnapshots = appSchema.table(
  'enterprise_ai_usage_snapshots',
  {
    id: id(),
    enterpriseId: bigint('enterprise_id', { mode: 'bigint' })
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    balance: numeric('balance', { precision: 18, scale: 6 })
      .notNull()
      .default('0'),
    currency: text('currency').notNull().default('USD'),
    dailyUsage: jsonb('daily_usage')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    keyInfo: jsonObject<Record<string, unknown>>('key_info'),
    lastSyncedAt: timestamp('last_synced_at', {
      withTimezone: true,
      mode: 'date',
    }),
    syncError: text('sync_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('enterprise_ai_usage_snapshots_enterprise_uidx').on(
      table.enterpriseId
    ),
  ]
);

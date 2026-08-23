import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import {
  adminUsers,
  enterprises,
  leadSitePhotos,
  leads,
  mediaAssets,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  AiCreationRepository,
  EnterpriseRepository,
  LeadRepository,
  LeadSitePhotoRepository,
} from '@/db/repositories';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import {
  canAccessLeadSitePhotos,
  LEAD_SITE_PHOTO_LIMIT,
  parseLeadSitePhotoSpaceTag,
} from '@/lib/lead-site-photos';

const runKey = `site-photo-${process.pid}-${Date.now()}`;
let enterpriseId: bigint;
let otherEnterpriseId: bigint;
let customerUserId: bigint;
let otherUserId: bigint;
let designerId: bigint;
let measurerId: bigint;
let outsiderId: bigint;
let leadId: bigint;
let otherLeadId: bigint;

async function jpegBuffer() {
  return sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 32, g: 160, b: 96 },
    },
  }).jpeg({ quality: 80 }).toBuffer();
}

async function insertSitePhoto(spaceTag: string, ownerLeadId = leadId) {
  const buffer = await jpegBuffer();
  const stored = await storePostgresMediaBuffer({
    enterpriseId,
    ownerType: 'lead_site_photo',
    ownerId: ownerLeadId,
    mimeType: 'image/jpeg',
    buffer,
    width: 640,
    height: 480,
  });
  return withTenantTransaction(enterpriseId, (transaction) =>
    new LeadSitePhotoRepository(transaction).create({
      enterpriseId,
      leadId: ownerLeadId,
      assetId: stored.asset.id,
      spaceTag,
      source: 'camera',
      createdByUserId: customerUserId,
      createdByStaffId: measurerId,
    })
  );
}

before(async () => {
  loadEnvConfig(process.cwd());
  const databaseUrl = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'Site photo tests only mutate the local database');

  await withPlatformTransaction(async (transaction) => {
    const enterprisesRepository = new EnterpriseRepository(transaction);
    enterpriseId = (await enterprisesRepository.create({
      name: `${runKey}-main`, code: `${runKey}-main`, status: 'active',
    })).id;
    otherEnterpriseId = (await enterprisesRepository.create({
      name: `${runKey}-other`, code: `${runKey}-other`, status: 'active',
    })).id;
    const [customer] = await transaction.insert(users).values({
      phone: `19${String(Date.now()).slice(-9)}`, nickname: `${runKey}-customer`,
    }).returning();
    const [other] = await transaction.insert(users).values({
      phone: `18${String(Date.now()).slice(-9)}`, nickname: `${runKey}-other`,
    }).returning();
    customerUserId = customer.id;
    otherUserId = other.id;
  });

  await withTenantTransaction(enterpriseId, async (transaction) => {
    const staff = new AdminUserRepository(transaction);
    designerId = (await staff.create({
      enterpriseId, username: `${runKey}-designer`, passwordHash: 'test-only',
      displayName: '现场图设计师', role: 'designer', status: 'active', assignmentPaused: false,
    })).id;
    measurerId = (await staff.create({
      enterpriseId, username: `${runKey}-measurer`, passwordHash: 'test-only',
      displayName: '现场图测量员', role: 'measurer', status: 'active', assignmentPaused: false,
    })).id;
    outsiderId = (await staff.create({
      enterpriseId, username: `${runKey}-other-designer`, passwordHash: 'test-only',
      displayName: '未派设计师', role: 'designer', status: 'active', assignmentPaused: false,
    })).id;
    const leadsRepo = new LeadRepository(transaction);
    leadId = (await leadsRepo.create({
      enterpriseId, assignedTo: designerId, measurerId, customerUserId,
      name: '现场图客户', phone: `17${String(Date.now()).slice(-9)}`,
      source: 'site-photo-test', assignmentStatus: 'assigned',
    })).id;
    otherLeadId = (await leadsRepo.create({
      enterpriseId, assignedTo: designerId, measurerId, customerUserId: otherUserId,
      name: '另一套房', phone: `16${String(Date.now()).slice(-9)}`,
      source: 'site-photo-test', assignmentStatus: 'assigned',
    })).id;
  });
});

after(async () => {
  await withPlatformTransaction(async (transaction) => {
    if (enterpriseId) {
      await transaction.delete(leadSitePhotos).where(eq(leadSitePhotos.enterpriseId, enterpriseId));
      await transaction.delete(mediaAssets).where(eq(mediaAssets.enterpriseId, enterpriseId));
      await transaction.delete(leads).where(eq(leads.enterpriseId, enterpriseId));
      await transaction.delete(adminUsers).where(eq(adminUsers.enterpriseId, enterpriseId));
    }
    const enterpriseIds = [enterpriseId, otherEnterpriseId].filter(Boolean);
    if (enterpriseIds.length) {
      await transaction.delete(enterprises).where(inArray(enterprises.id, enterpriseIds));
    }
    const userIds = [customerUserId, otherUserId].filter(Boolean);
    if (userIds.length) {
      await transaction.delete(users).where(inArray(users.id, userIds));
    }
  });
  await closePostgresPool();
});

test('gallery rows stay on one lead and keep the selected room tag', async () => {
  const living = await insertSitePhoto('living_room');
  const bath = await insertSitePhoto('master_bathroom');
  await insertSitePhoto('kitchen', otherLeadId);

  const listed = await withTenantTransaction(enterpriseId, (transaction) =>
    new LeadSitePhotoRepository(transaction).listActive(leadId)
  );
  assert.equal(listed.length, 2);
  assert.equal(listed[0]?.id, bath.id);
  assert.equal(listed[0]?.spaceTag, 'master_bathroom');
  assert.equal(listed[1]?.spaceTag, 'living_room');
  assert.ok(listed.every((row) => row.leadId === leadId));

  const actor = { mode: 'customer' as const, userId: customerUserId };
  const lead = { id: leadId, enterpriseId, customerUserId, assignedTo: designerId, measurerId, archivedAt: null };
  assert.equal(canAccessLeadSitePhotos(lead, actor), true);
  assert.equal(canAccessLeadSitePhotos(lead, { mode: 'customer', userId: otherUserId }), false);
  assert.equal(canAccessLeadSitePhotos(lead, {
    mode: 'staff', userId: customerUserId, staffId: outsiderId, staffRole: 'designer',
  }), false);
});

test('soft delete hides the gallery row but leaves the media asset for AI reuse', async () => {
  const photo = await insertSitePhoto('secondary_bathroom');
  const removed = await withTenantTransaction(enterpriseId, (transaction) =>
    new LeadSitePhotoRepository(transaction).softDelete(leadId, photo.id)
  );
  assert.ok(removed?.deletedAt);
  const listed = await withTenantTransaction(enterpriseId, (transaction) =>
    new LeadSitePhotoRepository(transaction).listActive(leadId)
  );
  assert.equal(listed.some((row) => row.id === photo.id), false);

  const asset = await withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).findMediaAsset(photo.assetId)
  );
  assert.ok(asset);
  assert.equal(asset.ownerType, 'lead_site_photo');
  assert.equal(asset.ownerId, leadId);
  assert.equal(asset.deletedAt, null);
  const counted = await withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).countMediaAssets([photo.assetId])
  );
  assert.equal(counted, 1);
});

test('active gallery count is capped at 30 photos per lead', async () => {
  assert.equal(LEAD_SITE_PHOTO_LIMIT, 30);
  const counted = await withTenantTransaction(enterpriseId, (transaction) =>
    new LeadSitePhotoRepository(transaction).countActive(leadId)
  );
  assert.ok(counted < LEAD_SITE_PHOTO_LIMIT);
  assert.equal(parseLeadSitePhotoSpaceTag('secondary_bedroom', { required: true }), 'secondary_bedroom');
});

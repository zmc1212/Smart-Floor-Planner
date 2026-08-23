import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessLeadSitePhotos,
  LEAD_SITE_PHOTO_LIMIT,
  LEAD_SITE_PHOTO_QUICK_TAGS,
  LEAD_SITE_PHOTO_SPACE_TAG_LABELS,
  parseLeadSitePhotoSource,
  parseLeadSitePhotoSpaceTag,
} from '@/lib/lead-site-photos';

const lead = {
  id: 10n,
  enterpriseId: 1n,
  customerUserId: 100n,
  assignedTo: 20n,
  measurerId: 30n,
  archivedAt: null,
};

test('site-photo access is the customer, assigned designer, assigned measurer, or enterprise owner', () => {
  assert.equal(canAccessLeadSitePhotos(lead, { mode: 'customer', userId: 100n }), true);
  assert.equal(canAccessLeadSitePhotos(lead, { mode: 'customer', userId: 101n }), false);
  assert.equal(canAccessLeadSitePhotos(lead, {
    mode: 'staff', userId: 1n, staffId: 20n, staffRole: 'designer',
  }), true);
  assert.equal(canAccessLeadSitePhotos(lead, {
    mode: 'staff', userId: 1n, staffId: 30n, staffRole: 'measurer',
  }), true);
  assert.equal(canAccessLeadSitePhotos(lead, {
    mode: 'staff', userId: 1n, staffId: 99n, staffRole: 'enterprise_admin',
  }), true);
  assert.equal(canAccessLeadSitePhotos(lead, {
    mode: 'staff', userId: 1n, staffId: 99n, staffRole: 'designer',
  }), false);
  assert.equal(canAccessLeadSitePhotos(lead, {
    mode: 'staff', userId: 1n, staffId: 99n, staffRole: 'salesperson',
  }), false);
  assert.equal(canAccessLeadSitePhotos(lead, { mode: 'referrer', userId: 100n }), false);
});

test('quick capture tags include living rooms and split bathrooms', () => {
  assert.deepEqual(
    LEAD_SITE_PHOTO_QUICK_TAGS.map((key) => LEAD_SITE_PHOTO_SPACE_TAG_LABELS[key]),
    ['客厅', '主卧', '次卧', '主卫', '次卫'],
  );
  assert.equal(LEAD_SITE_PHOTO_SPACE_TAG_LABELS.kitchen, '厨房');
  assert.equal(LEAD_SITE_PHOTO_SPACE_TAG_LABELS.dining_room, '餐厅');
  assert.equal(LEAD_SITE_PHOTO_LIMIT, 30);
});

test('upload requires a known room tag before the photo is stored', () => {
  assert.equal(parseLeadSitePhotoSpaceTag('master_bathroom', { required: true }), 'master_bathroom');
  assert.throws(
    () => parseLeadSitePhotoSpaceTag('', { required: true }),
    (error: unknown) => error instanceof Error && error.message === '请选择房间标签',
  );
  assert.throws(
    () => parseLeadSitePhotoSpaceTag('bathroom', { required: true }),
    (error: unknown) => error instanceof Error && error.message === '不支持的房间标签',
  );
  assert.equal(parseLeadSitePhotoSpaceTag(''), null);
  assert.equal(parseLeadSitePhotoSource('camera'), 'camera');
  assert.equal(parseLeadSitePhotoSource(''), 'album');
  assert.throws(() => parseLeadSitePhotoSource('drone'));
});

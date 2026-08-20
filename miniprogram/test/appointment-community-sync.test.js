const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMUNITY_MAX,
  normalizeCommunityFromAddress,
  canEditLeadProfile,
  shouldOfferCommunitySync,
  syncAddressToLeadCommunity,
} = require('../utils/appointmentCommunitySync.js');

test('normalizeCommunityFromAddress trims and caps at COMMUNITY_MAX', () => {
  assert.equal(normalizeCommunityFromAddress('  阳光花园 3栋 '), '阳光花园 3栋');
  assert.equal(normalizeCommunityFromAddress('x'.repeat(200)).length, COMMUNITY_MAX);
  assert.equal(normalizeCommunityFromAddress('   '), '');
});

test('canEditLeadProfile matches assigned designer, measurer, and enterprise owner', () => {
  const lead = { assignedTo: 'designer-1', measurerId: 'measurer-1' };
  assert.equal(canEditLeadProfile(lead, 'enterprise_admin', 'anyone'), true);
  assert.equal(canEditLeadProfile(lead, 'designer', 'designer-1'), true);
  assert.equal(canEditLeadProfile(lead, 'designer', 'other'), false);
  assert.equal(canEditLeadProfile(lead, 'measurer', 'measurer-1'), true);
  assert.equal(canEditLeadProfile(lead, 'measurer', 'other'), false);
  assert.equal(canEditLeadProfile({ ...lead, archivedAt: '2026-01-01' }, 'enterprise_admin', 'x'), false);
});

test('shouldOfferCommunitySync only when staff can edit and community is empty', () => {
  assert.equal(shouldOfferCommunitySync({
    canEditProfile: true,
    communityName: '',
    address: '阳光花园',
    customerMode: false,
  }), true);
  assert.equal(shouldOfferCommunitySync({
    canEditProfile: true,
    communityName: '已有小区',
    address: '阳光花园',
    customerMode: false,
  }), false);
  assert.equal(shouldOfferCommunitySync({
    canEditProfile: false,
    communityName: '',
    address: '阳光花园',
    customerMode: false,
  }), false);
  assert.equal(shouldOfferCommunitySync({
    canEditProfile: true,
    communityName: '',
    address: '阳光花园',
    customerMode: true,
  }), false);
  assert.equal(shouldOfferCommunitySync({
    canEditProfile: true,
    communityName: '',
    address: '  ',
    customerMode: false,
  }), false);
});

test('syncAddressToLeadCommunity skips when community already set', async () => {
  const calls = [];
  const api = {
    async request(url, method, body) {
      calls.push({ url, method, body });
      if (method === 'GET') return { data: { communityName: '已有小区' } };
      throw new Error('should not PUT');
    },
  };
  const result = await syncAddressToLeadCommunity(api, 'lead-1', '新地址');
  assert.deepEqual(result, { synced: false, reason: 'already_set' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('syncAddressToLeadCommunity writes sliced community when empty', async () => {
  const calls = [];
  const api = {
    async request(url, method, body) {
      calls.push({ url, method, body });
      if (method === 'GET') return { data: { communityName: null } };
      return { success: true };
    },
  };
  const long = `前缀${'楼'.repeat(200)}`;
  const result = await syncAddressToLeadCommunity(api, 'lead-2', long);
  assert.deepEqual(result, { synced: true });
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].body.communityName.length, COMMUNITY_MAX);
  assert.match(calls[1].url, /lead-2/);
});

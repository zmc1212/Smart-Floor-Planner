const COMMUNITY_MAX = 160;

function normalizeCommunityFromAddress(address) {
  return String(address || '').trim().slice(0, COMMUNITY_MAX);
}

function staffIdOf(value) {
  if (value == null) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

function canEditLeadProfile(lead, staffRole, staffId) {
  if (!lead || lead.archivedAt) return false;
  if (staffRole === 'enterprise_admin') return true;
  if (!staffId) return false;
  const id = String(staffId);
  if (staffRole === 'designer' && staffIdOf(lead.assignedTo) === id) return true;
  if (staffRole === 'measurer' && staffIdOf(lead.measurerId) === id) return true;
  return false;
}

function shouldOfferCommunitySync({
  canEditProfile,
  communityName,
  address,
  customerMode,
}) {
  if (customerMode) return false;
  if (!canEditProfile) return false;
  if (!normalizeCommunityFromAddress(address)) return false;
  if (String(communityName || '').trim()) return false;
  return true;
}

/**
 * Copy appointment address into lead.communityName when the community is empty.
 * @returns {{ synced: true } | { synced: false, reason: 'empty' | 'already_set' }}
 */
async function syncAddressToLeadCommunity(api, leadId, address) {
  const communityName = normalizeCommunityFromAddress(address);
  if (!communityName) return { synced: false, reason: 'empty' };
  const result = await api.request(`/leads/${encodeURIComponent(leadId)}`, 'GET');
  const lead = result && result.data;
  if (String(lead && lead.communityName || '').trim()) {
    return { synced: false, reason: 'already_set' };
  }
  await api.request(`/leads/${encodeURIComponent(leadId)}`, 'PUT', { communityName });
  return { synced: true };
}

module.exports = {
  COMMUNITY_MAX,
  normalizeCommunityFromAddress,
  canEditLeadProfile,
  shouldOfferCommunitySync,
  syncAddressToLeadCommunity,
};

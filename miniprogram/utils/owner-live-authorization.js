const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value);

function ownerLiveAuthorizationPath(projectId, item) {
  if (![projectId, item?.id, item?.versionId].every(validId)) return '';
  return '/packages/construction/live-authorization/live-authorization?projectId=' + projectId
    + '&liveId=' + item.id + '&versionId=' + item.versionId;
}

module.exports = { validId, ownerLiveAuthorizationPath };

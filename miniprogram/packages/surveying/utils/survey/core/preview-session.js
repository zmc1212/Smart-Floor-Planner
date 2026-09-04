
function resetPreviewSideLock(session) {
  if (!session) return;
  session.previewBodyNormalSide = '';
  session.measurementSideUserSet = false;
}

module.exports = {
  resetPreviewSideLock
};

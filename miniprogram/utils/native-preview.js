// wx.previewImage opens a native page, so the host page receives onHide when
// the viewer opens and onShow when it closes. Pages that reload or tear down
// their state in those hooks would rebuild the whole screen after every
// preview. Arm a short-lived guard before opening the viewer and let the
// lifecycle hooks skip exactly that hide/show pair.
const GUARD_MS = 3000;
const RETURN_MS = 300;

function currentPage() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    return pages && pages.length ? pages[pages.length - 1] : null;
  } catch (_) {
    return null;
  }
}

function disarm(page) {
  if (!page) return;
  page.__nativePreviewAt = 0;
  clearTimeout(page.__nativePreviewTimer);
}

function openImageAction(method, options, owner) {
  const page = owner || currentPage();
  if (page) {
    page.__nativePreviewAt = Date.now();
    clearTimeout(page.__nativePreviewTimer);
    page.__nativePreviewTimer = setTimeout(() => { page.__nativePreviewAt = 0; }, GUARD_MS);
  }
  const input = options || {};
  try {
    wx[method]({ ...input, fail(error) {
      disarm(page);
      if (typeof input.fail === 'function') input.fail(error);
    } });
  } catch (error) {
    disarm(page);
    if (typeof input.fail === 'function') input.fail(error);
    else throw error;
  }
}

function previewImage(options, owner) {
  openImageAction('previewImage', options, owner);
}

function shareImage(options, owner) {
  openImageAction('showShareImageMenu', options, owner);
}

// Call at the start of onHide / pageLifetimes.hide. Returns true when the hide
// belongs to the native viewer, so the caller keeps its current UI state.
function hiddenByPreview(page) {
  if (!page) return false;
  if (page.__nativePreviewReturn && !page.__nativePreviewShown) return true;
  if (page.__nativePreviewReturn) clearReturn(page);
  if (!page.__nativePreviewAt) return false;
  if (Date.now() - page.__nativePreviewAt > GUARD_MS) {
    disarm(page);
    return false;
  }
  disarm(page);
  page.__nativePreviewReturn = true;
  page.__nativePreviewShown = false;
  return true;
}

// Call at the start of onShow / pageLifetimes.show. Returns true for the show
// that follows the native viewer; the short window lets both the page and its
// embedded components observe the same return without consuming it first.
function shownAfterPreview(page) {
  if (!page || !page.__nativePreviewReturn) return false;
  page.__nativePreviewShown = true;
  clearTimeout(page.__nativePreviewReturnTimer);
  page.__nativePreviewReturnTimer = setTimeout(() => clearReturn(page), RETURN_MS);
  return true;
}

function clearReturn(page) {
  page.__nativePreviewReturn = false;
  page.__nativePreviewShown = false;
  clearTimeout(page.__nativePreviewReturnTimer);
}

module.exports = { currentPage, previewImage, shareImage, hiddenByPreview, shownAfterPreview };

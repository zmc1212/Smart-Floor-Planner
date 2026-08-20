const SHEET_MOTION_MS = 260;
const SHEET_ENTER_DELAY_MS = 20;

function timerKey(openKey) {
  return `_sheetMotionTimer_${openKey}`;
}

function clearSheetTimer(host, openKey) {
  const key = timerKey(openKey);
  if (host[key]) {
    clearTimeout(host[key]);
    host[key] = null;
  }
}

/**
 * Mount a sheet, then add the open class on the next frame so CSS transitions run.
 * @param {WechatMiniprogram.Page.Instance|WechatMiniprogram.Component.Instance} host
 * @param {{ mountedKey: string, openKey: string }} keys
 */
function openSheet(host, { mountedKey, openKey }) {
  clearSheetTimer(host, openKey);
  if (host.data[mountedKey] && host.data[openKey]) return;
  host.setData({ [mountedKey]: true, [openKey]: false }, () => {
    host[timerKey(openKey)] = setTimeout(() => {
      host.setData({ [openKey]: true });
      host[timerKey(openKey)] = null;
    }, SHEET_ENTER_DELAY_MS);
  });
}

/**
 * Remove the open class, then unmount after the exit transition.
 * @param {WechatMiniprogram.Page.Instance|WechatMiniprogram.Component.Instance} host
 * @param {{ mountedKey: string, openKey: string }} keys
 * @param {(() => void)=} onClosed
 */
function closeSheet(host, { mountedKey, openKey }, onClosed) {
  clearSheetTimer(host, openKey);
  const mounted = Boolean(host.data[mountedKey]);
  const open = Boolean(host.data[openKey]);
  if (!mounted && !open) {
    if (typeof onClosed === 'function') onClosed();
    return;
  }
  host.setData({ [openKey]: false });
  host[timerKey(openKey)] = setTimeout(() => {
    host.setData({ [mountedKey]: false });
    host[timerKey(openKey)] = null;
    if (typeof onClosed === 'function') onClosed();
  }, SHEET_MOTION_MS);
}

/**
 * Instantly unmount without playing the exit transition (panel swaps).
 * @param {WechatMiniprogram.Page.Instance|WechatMiniprogram.Component.Instance} host
 * @param {{ mountedKey: string, openKey: string }} keys
 */
function dismissSheet(host, { mountedKey, openKey }) {
  clearSheetTimer(host, openKey);
  if (!host.data[mountedKey] && !host.data[openKey]) return;
  host.setData({ [mountedKey]: false, [openKey]: false });
}

module.exports = {
  SHEET_MOTION_MS,
  SHEET_ENTER_DELAY_MS,
  openSheet,
  closeSheet,
  dismissSheet,
  clearSheetTimer,
};

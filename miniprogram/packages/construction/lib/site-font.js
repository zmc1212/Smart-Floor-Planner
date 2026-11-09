// One offline font shared by the construction pages. Brotli is uploadable; .woff2 is not.
let loading;
function loadSiteFont() {
  if (typeof wx === 'undefined' || typeof wx.loadFontFace !== 'function'
    || typeof wx.getFileSystemManager !== 'function' || typeof wx.arrayBufferToBase64 !== 'function') return Promise.resolve(false);
  if (loading) return loading;
  loading = new Promise(resolve => {
    let done = false;
    const finish = loaded => { if (done) return; done = true; clearTimeout(timer); resolve(loaded); };
    const timer = setTimeout(() => finish(false), 6000);
    try {
      wx.getFileSystemManager().readCompressedFile({
        filePath: 'packages/construction/assets/notebook-font.woff2.br', compressionAlgorithm: 'br',
        success: ({ data }) => {
          if (done) return;
          try {
            wx.loadFontFace({ global: true, family: 'Site Serif',
              source: 'url("data:font/woff2;base64,' + wx.arrayBufferToBase64(data) + '")', desc: { weight: '900', style: 'normal' },
              success: () => finish(true), fail: () => finish(false) });
          } catch (_) { finish(false); }
        },
        fail: () => finish(false),
      });
    } catch (_) { finish(false); }
  });
  loading = loading.then(loaded => { if (!loaded) loading = null; return loaded; });
  return loading;
}
module.exports = { loadSiteFont };

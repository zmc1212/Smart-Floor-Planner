const ID = /^[1-9]\d{0,18}$/;
const HOST = /^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

function clean(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

function tourUrl(value) {
  if (typeof value !== 'string' || value.length > 500 || !/^https:\/\//i.test(value)) return '';
  if (/[\s\u0000-\u001f\u007f\\]/.test(value)) return '';
  const match = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value);
  if (!match) return '';
  const authority = match[1];
  if (!authority || authority.includes('@') || authority.startsWith('[') || authority.includes(':')) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(authority) || !HOST.test(authority)) return '';
  return value;
}

function toursForView(work) {
  const tours = Array.isArray(work && work.tours) ? work.tours : [];
  return tours.map((tour, sourceIndex) => {
    const url = tourUrl(tour && tour.url);
    if (!url) return null;
    const title = clean(tour.title, 60);
    const provider = clean(tour.provider, 30) || '第三方 3D';
    return { url, provider, title: title || provider, sourceIndex };
  }).filter(Boolean).slice(0, 3).map((tour, index) => ({ ...tour, index }));
}

function selectTour(work, index) {
  if (!Number.isInteger(index) || index < 0) return null;
  return toursForView(work)[index] || null;
}

function tourInput(options = {}) {
  const conversationId = String(options.conversationId || ''), workId = String(options.workId || ''), versionId = String(options.versionId || '');
  const index = /^[0-2]$/.test(String(options.index == null ? '' : options.index)) ? Number(options.index) : NaN;
  if (![conversationId, workId, versionId].every(value => ID.test(value)) || !Number.isInteger(index)) return null;
  return { conversationId, workId, versionId, index };
}

module.exports = { tourInput, selectTour, toursForView, tourUrl };

const sitePhotos = require('../../utils/sitePhotoService.js');
const { openSheet, closeSheet, clearSheetTimer } = require('../../utils/sheetMotion.js');

const TAG_SHEET = { mountedKey: 'tagMounted', openKey: 'tagOpen' };

function splitTags(tags) {
  const list = Array.isArray(tags) && tags.length ? tags : sitePhotos.SPACE_TAGS;
  return {
    quickTags: list.filter((item) => item.quick),
    moreTags: list.filter((item) => !item.quick),
  };
}

Component({
  properties: {
    leadId: { type: String, value: '' },
    photos: { type: Array, value: [] },
    spaceTags: { type: Array, value: [] },
    showAdd: { type: Boolean, value: true },
    uploading: { type: Boolean, value: false },
    mode: { type: String, value: 'gallery' },
    selectedAssetId: { type: String, value: '' },
    limitReached: { type: Boolean, value: false },
    embed: { type: Boolean, value: true },
    captureNonce: { type: Number, value: 0 },
    captureSource: { type: String, value: '' },
  },

  data: {
    tagMounted: false,
    tagOpen: false,
    quickTags: splitTags().quickTags,
    moreTags: splitTags().moreTags,
    pendingSource: '',
    pendingRetagId: '',
  },

  observers: {
    spaceTags(tags) {
      this.setData(splitTags(tags));
    },
    captureNonce(value) {
      if (!value) return;
      this.setData({ pendingSource: this.properties.captureSource || '', pendingRetagId: '' });
      this.openTagSheet();
    },
  },

  lifetimes: {
    detached() {
      clearSheetTimer(this, TAG_SHEET.openKey);
      if (this.data.tagMounted) this.emitSheetChange(false);
    },
  },

  methods: {
    emitSheetChange(open) {
      this.triggerEvent('sheetchange', { open: Boolean(open) });
    },

    openTagSheet() {
      if (this.properties.uploading) return;
      if (this.properties.limitReached) {
        wx.showToast({ title: '本户现场图已满 30 张', icon: 'none' });
        return;
      }
      this.emitSheetChange(true);
      openSheet(this, TAG_SHEET);
    },

    closeTagSheet() {
      closeSheet(this, TAG_SHEET, () => this.emitSheetChange(false));
    },

    onCloseTagSheet() {
      this.closeTagSheet();
    },

    onAdd() {
      this.setData({ pendingSource: '', pendingRetagId: '' });
      this.openTagSheet();
    },

    async onPickTag(event) {
      const spaceTag = event.currentTarget.dataset.key;
      if (!spaceTag || this.properties.uploading) return;
      const retagId = this.data.pendingRetagId;
      this.closeTagSheet();
      if (retagId) {
        this.setData({ pendingRetagId: '' });
        try {
          const updated = await sitePhotos.updateTag(this.properties.leadId, retagId, spaceTag);
          this.triggerEvent('change', { photo: updated });
        } catch (error) {
          wx.showToast({ title: (error && error.error) || '标签更新失败', icon: 'none' });
        }
        return;
      }
      try {
        const source = this.data.pendingSource || await sitePhotos.chooseCaptureSource();
        this.triggerEvent('uploading', { uploading: true });
        const photo = await sitePhotos.captureAndUpload(this.properties.leadId, { source, spaceTag });
        this.triggerEvent('uploading', { uploading: false });
        this.triggerEvent('captured', { photo, source, spaceTag });
        this.triggerEvent('change', { photo });
      } catch (error) {
        this.triggerEvent('uploading', { uploading: false });
        if (error && error.cancelled) return;
        wx.showToast({ title: (error && error.error) || '现场图上传失败', icon: 'none' });
      }
    },

    onTapPhoto(event) {
      const photo = (this.properties.photos || []).find((item) => String(item.id) === String(event.currentTarget.dataset.id));
      if (!photo) return;
      if (this.properties.mode === 'picker') {
        this.triggerEvent('select', { photo });
        return;
      }
      const preview = sitePhotos.previewUrls(this.properties.photos, photo);
      if (!preview.current) return;
      wx.previewImage({ current: preview.current, urls: preview.urls });
    },

    noop() {},

    onManagePhoto(event) {
      if (this.properties.mode === 'picker') return;
      const photo = (this.properties.photos || []).find((item) => String(item.id) === String(event.currentTarget.dataset.id));
      if (!photo) return;
      wx.showActionSheet({
        itemList: ['更换房间标签', '删除这张现场图'],
        success: (res) => {
          if (res.tapIndex === 0) this.retargetPhoto(photo);
          else if (res.tapIndex === 1) this.deletePhoto(photo);
        },
      });
    },

    retargetPhoto(photo) {
      this.setData({ pendingRetagId: photo.id, pendingSource: '' });
      this.openTagSheet();
    },

    deletePhoto(photo) {
      wx.showModal({
        title: '删除现场图',
        content: '从图库移除后，设计时将不再列出这张图。已用于出图的任务不受影响。',
        confirmText: '删除',
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await sitePhotos.remove(this.properties.leadId, photo.id);
            this.triggerEvent('removed', { photo });
            this.triggerEvent('change', { photo: null, removedId: photo.id });
          } catch (error) {
            wx.showToast({ title: (error && error.error) || '删除失败', icon: 'none' });
          }
        },
      });
    },
  },
});

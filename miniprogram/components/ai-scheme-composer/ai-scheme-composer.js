const {
  buildComposerViewState,
  buildTemplateCategoryChips,
} = require('./ai-scheme-composer-model.js');
const {
  openSheet,
  closeSheet,
  clearSheetTimer,
} = require('../../utils/sheetMotion.js');

const PICKER_SHEET = { mountedKey: 'pickerMounted', openKey: 'pickerVisible' };
const SETTINGS_SHEET = { mountedKey: 'settingsMounted', openKey: 'settingsOpen' };
const TEMPLATE_SHEET = { mountedKey: 'templateSheetMounted', openKey: 'templateSheetOpen' };

Component({
  properties: {
    bootstrap: { type: Object, value: null },
    draft: { type: Object, value: null },
    generating: { type: Boolean, value: false },
    assisting: { type: Boolean, value: false },
    uploading: { type: Boolean, value: false },
    templates: { type: Array, value: [] },
    templateCategories: { type: Array, value: [] },
    templateCategoryId: { type: String, value: '' },
    templateQuery: { type: String, value: '' },
    templateLoading: { type: Boolean, value: false },
    templateLoadingMore: { type: Boolean, value: false },
    templateHasMore: { type: Boolean, value: false },
    templateSheetVisible: { type: Boolean, value: false },
    scopes: { type: Array, value: [] },
    floorPlanPreviewUrl: { type: String, value: '' },
  },

  data: {
    view: null,
    dockExpanded: false,
    keyboardHeight: 0,
    pickerType: '',
    pickerMounted: false,
    pickerVisible: false,
    pickerTitle: '',
    pickerOptions: [],
    settingsMounted: false,
    settingsOpen: false,
    templateCategoryChips: [],
    templateSheetMounted: false,
    templateSheetOpen: false,
    templatePreviewVisible: false,
    templatePreview: null,
  },

  observers: {
    'bootstrap, draft, generating, assisting, uploading, scopes, floorPlanPreviewUrl': function updateView() {
      if (!this.properties.draft || !this.properties.bootstrap) {
        this.setData({ view: null });
        return;
      }
      this.setData({
        view: buildComposerViewState(this.properties.draft, this.properties.bootstrap, {
          generating: this.properties.generating,
          assisting: this.properties.assisting,
          uploading: this.properties.uploading,
          scopes: this.properties.scopes,
          floorPlanPreviewUrl: this.properties.floorPlanPreviewUrl,
        }),
      });
    },
    'templateCategories, templateCategoryId': function updateCategoryChips() {
      this.setData({
        templateCategoryChips: buildTemplateCategoryChips(
          this.properties.templateCategories,
          this.properties.templateCategoryId,
        ),
      });
    },
    templateSheetVisible(visible) {
      if (visible) {
        openSheet(this, TEMPLATE_SHEET);
        return;
      }
      this.setData({ templatePreviewVisible: false, templatePreview: null });
      closeSheet(this, TEMPLATE_SHEET);
    },
  },

  lifetimes: {
    attached() {
      this._onKeyboardHeightChange = (res) => {
        const height = Math.max(0, Math.floor(Number(res && res.height) || 0));
        if (height === this.data.keyboardHeight) return;
        this.setData({ keyboardHeight: height });
        this.triggerEvent('keyboardheightchange', { height });
        if (height > 0) {
          this.clearCollapseTimer();
          this.setDockExpanded(true);
        }
      };
      if (typeof wx.onKeyboardHeightChange === 'function') {
        wx.onKeyboardHeightChange(this._onKeyboardHeightChange);
      }
    },

    detached() {
      this.clearCollapseTimer();
      if (typeof wx.offKeyboardHeightChange === 'function' && this._onKeyboardHeightChange) {
        wx.offKeyboardHeightChange(this._onKeyboardHeightChange);
      }
      this.triggerEvent('keyboardheightchange', { height: 0 });
      clearSheetTimer(this, PICKER_SHEET.openKey);
      clearSheetTimer(this, SETTINGS_SHEET.openKey);
      clearSheetTimer(this, TEMPLATE_SHEET.openKey);
    },
  },

  methods: {
    clearCollapseTimer() {
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer);
        this._collapseTimer = null;
      }
    },

    setDockExpanded(expanded) {
      const next = Boolean(expanded);
      if (this.data.dockExpanded === next) return;
      this.setData({ dockExpanded: next });
      this.triggerEvent('dockexpandchange', { expanded: next });
    },

    expandDock() {
      this.clearCollapseTimer();
      this.setDockExpanded(true);
    },

    collapseDock() {
      if (
        this.data.keyboardHeight > 0
        || this.data.settingsOpen
        || this.data.pickerVisible
        || this.data.templateSheetOpen
        || this.data.templatePreviewVisible
      ) {
        return;
      }
      this.setDockExpanded(false);
    },

    onPromptFocus() {
      this.clearCollapseTimer();
      this.setDockExpanded(true);
    },

    onPromptBlur() {
      this.clearCollapseTimer();
      this._collapseTimer = setTimeout(() => {
        this.collapseDock();
      }, 220);
    },

    holdDockExpanded() {
      this.clearCollapseTimer();
      this.setDockExpanded(true);
    },

    onPromptInput(event) {
      this.triggerEvent('draftchange', { field: 'prompt', value: event.detail.value });
    },

    openSettings() {
      if (!this.data.view) return;
      this.holdDockExpanded();
      openSheet(this, SETTINGS_SHEET);
    },

    closeSettings() {
      closeSheet(this, SETTINGS_SHEET, () => {
        this.clearCollapseTimer();
        this._collapseTimer = setTimeout(() => this.collapseDock(), 220);
      });
    },

    selectSettingChip(event) {
      const { field, value } = event.currentTarget.dataset;
      if (!field) return;
      if (field === 'count') {
        this.triggerEvent('draftchange', { field: 'count', value: Number(value) });
        return;
      }
      this.triggerEvent('draftchange', { field, value });
    },

    openPicker(event) {
      const { type } = event.currentTarget.dataset;
      const view = this.data.view;
      if (!view || !type) return;
      this.holdDockExpanded();
      let title = '';
      let options = [];
      if (type === 'model') {
        title = '选择模型';
        options = view.modelOptions.map((item) => ({
          value: item.id,
          label: item.name,
          active: item.active,
        }));
      } else if (type === 'aspect') {
        title = '选择比例';
        options = view.aspectOptions;
      } else if (type === 'resolution') {
        title = '选择分辨率';
        options = view.resolutionOptions;
      } else if (type === 'count') {
        title = '出图张数';
        options = view.countOptions;
      } else if (type === 'scope') {
        title = '应用到哪里';
        options = view.scopePickerOptions;
      }
      if (!options.length) return;
      this.setData({
        pickerType: type,
        pickerTitle: title,
        pickerOptions: options,
      });
      openSheet(this, PICKER_SHEET);
    },

    closePicker() {
      closeSheet(this, PICKER_SHEET, () => {
        this.setData({ pickerType: '', pickerOptions: [] });
        this.clearCollapseTimer();
        this._collapseTimer = setTimeout(() => this.collapseDock(), 220);
      });
    },

    selectPickerOption(event) {
      const { value } = event.currentTarget.dataset;
      const type = this.data.pickerType;
      if (!type) return;
      if (type === 'model') {
        this.triggerEvent('modelchange', { modelProfileId: value });
      } else if (type === 'aspect') {
        this.triggerEvent('draftchange', { field: 'aspectRatio', value });
      } else if (type === 'resolution') {
        this.triggerEvent('draftchange', { field: 'resolutionTier', value });
      } else if (type === 'count') {
        this.triggerEvent('draftchange', { field: 'count', value: Number(value) });
      } else if (type === 'scope') {
        const option = (this.data.pickerOptions || []).find((item) => String(item.value) === String(value));
        this.triggerEvent('scopechange', {
          targetScope: option && option.targetScope === 'single_room' ? 'single_room' : 'whole_floor_plan',
          roomId: option && option.targetScope === 'single_room' ? String(option.roomId || '') : '',
        });
      }
      this.closePicker();
    },

    uploadReference() {
      if (!this.data.view || !this.data.view.canAddReference || this.properties.uploading) return;
      this.holdDockExpanded();
      this.triggerEvent('uploadreference');
    },

    previewControl() {
      const url = this.data.view && this.data.view.controlPreviewUrl;
      if (!url) return;
      this.holdDockExpanded();
      wx.previewImage({ urls: [url], current: url });
    },

    removeReference(event) {
      const { id } = event.currentTarget.dataset;
      this.holdDockExpanded();
      this.triggerEvent('removereference', { id });
    },

    openTemplates() {
      this.holdDockExpanded();
      this.triggerEvent('opentemplates');
    },

    closeTemplates() {
      this.setData({ templatePreviewVisible: false, templatePreview: null });
      this.triggerEvent('closetemplates');
    },

    onTemplateQueryInput(event) {
      this.triggerEvent('templatequerychange', { query: event.detail.value || '' });
    },

    onTemplateQueryConfirm(event) {
      this.triggerEvent('templatequerychange', {
        query: event.detail.value || '',
        immediate: true,
      });
    },

    clearTemplateQuery() {
      this.triggerEvent('templatequerychange', { query: '', immediate: true });
    },

    selectTemplateCategory(event) {
      const raw = event.currentTarget.dataset.id;
      const categoryId = raw == null || raw === '__all__' ? '' : String(raw);
      this.triggerEvent('templatecategorychange', { categoryId });
    },

    loadMoreTemplates() {
      if (!this.properties.templateHasMore || this.properties.templateLoadingMore) return;
      this.triggerEvent('templateloadmore');
    },

    previewTemplateImage(event) {
      const { id } = event.currentTarget.dataset;
      const template = (this.properties.templates || []).find((item) => String(item.id) === String(id));
      if (!template) return;
      if (!template.previewUrl || template.previewFailed) {
        wx.showToast({ title: '该模板暂无预览图', icon: 'none' });
        return;
      }
      this.setData({
        templatePreviewVisible: true,
        templatePreview: {
          id: template.id,
          name: template.name || '',
          previewUrl: template.previewUrl,
        },
      });
    },

    closeTemplatePreview() {
      this.setData({ templatePreviewVisible: false, templatePreview: null });
    },

    openNativeTemplatePreview() {
      const current = this.data.templatePreview?.previewUrl;
      if (!current) return;
      const urls = (this.properties.templates || [])
        .map((item) => item.previewUrl)
        .filter((url) => Boolean(url));
      wx.previewImage({
        current,
        urls: urls.length ? urls : [current],
      });
    },

    selectTemplate(event) {
      const { id } = event.currentTarget.dataset;
      const template = (this.properties.templates || []).find((item) => String(item.id) === String(id));
      if (!template) return;
      this.setData({ templatePreviewVisible: false, templatePreview: null });
      this.triggerEvent('selecttemplate', { template });
      this.closeTemplates();
    },

    onTemplateImageError(event) {
      const { id } = event.currentTarget.dataset;
      if (!id) return;
      this.triggerEvent('templateimageerror', { id });
    },

    assistPrompt() {
      if (this.properties.assisting) return;
      this.holdDockExpanded();
      this.triggerEvent('assistprompt');
    },

    submitGeneration() {
      this.holdDockExpanded();
      if (!this.data.view || !this.data.view.canSubmit) {
        if (this.data.view?.blockedReason) {
          wx.showToast({ title: this.data.view.blockedReason, icon: 'none' });
        }
        return;
      }
      this.triggerEvent('submit');
    },

    noop() {},
  },
});

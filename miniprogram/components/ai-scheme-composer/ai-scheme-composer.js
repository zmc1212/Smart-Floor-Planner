const {
  applyRenderModeToDraft,
  buildComposerPickerOptions,
  buildComposerPickerTitle,
  buildComposerViewState,
  buildTemplateCategoryChips,
  restoreTemplatePrompt,
  setTemplateFullEditMode,
} = require('./ai-scheme-composer-model.js');
const {
  openSheet,
  closeSheet,
  clearSheetTimer,
} = require('../../utils/sheetMotion.js');

const PICKER_SHEET = { mountedKey: 'pickerMounted', openKey: 'pickerVisible' };
const SETTINGS_SHEET = { mountedKey: 'settingsMounted', openKey: 'settingsOpen' };
const TEMPLATE_SHEET = { mountedKey: 'templateSheetMounted', openKey: 'templateSheetOpen' };
const MODE_PICKER_SHEET = { mountedKey: 'modePickerMounted', openKey: 'modePickerVisible' };
const KEYBOARD_HIDE_TIMEOUT_MS = 300;

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
    timelineMode: { type: Boolean, value: false },
    scopes: { type: Array, value: [] },
    floorPlanPreviewUrl: { type: String, value: '' },
    autoOpenRound: { type: Boolean, value: false },
  },

  data: {
    view: null,
    dockExpanded: false,
    keyboardHeight: 0,
    promptFocused: false,
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
    modePickerMounted: false,
    modePickerVisible: false,
    pendingRenderMode: 'whole_floor_plan',
  },

  observers: {
    'bootstrap, draft, generating, assisting, uploading, scopes, floorPlanPreviewUrl': function updateView() {
      this.refreshView();
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
      closeSheet(this, TEMPLATE_SHEET, () => {
        if (this._templateReturnTarget === 'mode-picker') {
          this._templateReturnTarget = '';
          this._refocusAfterTemplate = false;
          openSheet(this, MODE_PICKER_SHEET);
          return;
        }
        if (this._refocusAfterTemplate) {
          this._refocusAfterTemplate = false;
          this.restorePromptFocus();
        }
      });
    },
    'autoOpenRound, view': function autoOpenRound(visible, view) {
      if (!visible || !view || this._autoRoundOpened) return;
      this._autoRoundOpened = true;
      setTimeout(() => this.openModePicker(), 120);
    },
  },

  lifetimes: {
    attached() {
      this.refreshView();
      this._onKeyboardHeightChange = (res) => {
        const height = Math.max(0, Math.floor(Number(res && res.height) || 0));
        if (height === this.data.keyboardHeight) {
          if (height === 0) this.flushKeyboardWait();
          return;
        }
        this.setData({ keyboardHeight: height });
        this.triggerEvent('keyboardheightchange', { height });
        if (height > 0) {
          this.clearCollapseTimer();
          this.setDockExpanded(true);
          return;
        }
        this.flushKeyboardWait();
      };
      if (typeof wx.onKeyboardHeightChange === 'function') {
        wx.onKeyboardHeightChange(this._onKeyboardHeightChange);
      }
    },

    detached() {
      this.clearCollapseTimer();
      this.clearKeyboardWait();
      if (typeof wx.offKeyboardHeightChange === 'function' && this._onKeyboardHeightChange) {
        wx.offKeyboardHeightChange(this._onKeyboardHeightChange);
      }
      this.triggerEvent('keyboardheightchange', { height: 0 });
      clearSheetTimer(this, PICKER_SHEET.openKey);
      clearSheetTimer(this, SETTINGS_SHEET.openKey);
      clearSheetTimer(this, TEMPLATE_SHEET.openKey);
      clearSheetTimer(this, MODE_PICKER_SHEET.openKey);
    },
  },

  methods: {
    refreshView(draftOverride) {
      const draft = draftOverride || this.properties.draft;
      if (!draft || !this.properties.bootstrap) {
        this.setData({ view: null });
        return;
      }
      this.setData({
        view: buildComposerViewState(draft, this.properties.bootstrap, {
          generating: this.properties.generating,
          assisting: this.properties.assisting,
          uploading: this.properties.uploading,
          scopes: this.properties.scopes,
          floorPlanPreviewUrl: this.properties.floorPlanPreviewUrl,
        }),
      });
    },

    clearCollapseTimer() {
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer);
        this._collapseTimer = null;
      }
    },

    clearKeyboardWait() {
      if (this._keyboardWaitTimer) {
        clearTimeout(this._keyboardWaitTimer);
        this._keyboardWaitTimer = null;
      }
      this._afterKeyboardHidden = null;
    },

    flushKeyboardWait() {
      const next = this._afterKeyboardHidden;
      if (!next) return;
      this.clearKeyboardWait();
      this._openingSheet = false;
      next();
    },

    runAfterKeyboardHidden(callback) {
      this.clearKeyboardWait();
      this._openingSheet = true;
      this.clearCollapseTimer();
      this.setDockExpanded(true);
      this.setData({ promptFocused: false });

      const finish = () => {
        this.clearKeyboardWait();
        this._openingSheet = false;
        callback();
      };

      if (this.data.keyboardHeight <= 0) {
        this._keyboardWaitTimer = setTimeout(finish, 20);
        return;
      }

      this._afterKeyboardHidden = finish;
      this._keyboardWaitTimer = setTimeout(finish, KEYBOARD_HIDE_TIMEOUT_MS);
    },

    restorePromptFocus() {
      this.clearCollapseTimer();
      this.setDockExpanded(true);
      this.setData({ promptFocused: false }, () => {
        this.setData({ promptFocused: true });
      });
    },

    finishSheetWithoutRefocus() {
      this.clearCollapseTimer();
      this._collapseTimer = setTimeout(() => this.collapseDock(), 220);
    },

    setDockExpanded(expanded) {
      const next = Boolean(expanded);
      if (this.data.dockExpanded === next) return;
      this.setData({ dockExpanded: next });
      this.triggerEvent('dockexpandchange', { expanded: next });
    },

    expandDock() {
      this.clearCollapseTimer();
      if (this.data.view && !this.data.view.modeConfirmed) {
        this.openModePicker();
        return;
      }
      this.setDockExpanded(true);
    },

    toggleDock() {
      if (!this.data.dockExpanded) {
        this.expandDock();
        return;
      }
      if (this.data.keyboardHeight > 0) {
        this.setData({ promptFocused: false });
        if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
        setTimeout(() => this.setDockExpanded(false), KEYBOARD_HIDE_TIMEOUT_MS);
        return;
      }
      this.collapseDock();
    },

    enterTemplateFullEdit() {
      if (!this.properties.draft?.templateId) return;
      this.clearCollapseTimer();
      const draft = setTemplateFullEditMode(this.properties.draft, this.properties.draft?.prompt || '');
      this.triggerEvent('draftchange', { draft });
      this.setDockExpanded(true);
      this.setData({ promptFocused: false }, () => this.setData({ promptFocused: true }));
    },

    restoreSelectedTemplate() {
      const draft = restoreTemplatePrompt(this.properties.draft);
      this.triggerEvent('draftchange', { draft });
      this.setDockExpanded(true);
      this.setData({ promptFocused: false }, () => this.setData({ promptFocused: true }));
    },

    returnToTemplateSummary() {
      this.clearCollapseTimer();
      this.setData({ promptFocused: false });
      if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
      setTimeout(() => this.setDockExpanded(false), KEYBOARD_HIDE_TIMEOUT_MS);
    },

    openModePicker() {
      this.clearCollapseTimer();
      const currentMode = this.properties.draft && this.properties.draft.renderMode;
      const pendingRenderMode = currentMode
        || (this.data.view && this.data.view.wholeHouseAvailable ? 'whole_floor_plan' : 'single_room_photo');
      this.setData({ promptFocused: false, pendingRenderMode });
      openSheet(this, MODE_PICKER_SHEET);
    },

    closeModePicker() {
      closeSheet(this, MODE_PICKER_SHEET, () => {
        if (this.properties.draft && this.properties.draft.renderModeConfirmed) {
          this.setDockExpanded(true);
        }
      });
    },

    selectRenderMode(event) {
      const mode = event.currentTarget.dataset.mode;
      if (mode === 'whole_floor_plan' && !this.data.view?.wholeHouseAvailable) {
        wx.showToast({ title: '整屋设计需先完成正式量房', icon: 'none' });
        return;
      }
      const current = this.data.pendingRenderMode;
      const next = mode === 'single_room_photo' && current === 'soft_furnishing'
        ? 'soft_furnishing'
        : mode;
      this.setData({ pendingRenderMode: next });
    },

    commitPendingRenderMode() {
      const mode = this.data.pendingRenderMode;
      const current = this.properties.draft || {};
      if (current.renderModeConfirmed && current.renderMode === mode) return current;
      const draft = applyRenderModeToDraft(current, mode);
      this.triggerEvent('rendermodechange', { draft, renderMode: draft.renderMode });
      return draft;
    },

    confirmRenderMode() {
      const mode = this.data.pendingRenderMode;
      if (mode === 'whole_floor_plan' && !this.data.view?.wholeHouseAvailable) {
        wx.showToast({ title: '整屋设计需先完成正式量房', icon: 'none' });
        return;
      }
      this.commitPendingRenderMode();
      closeSheet(this, MODE_PICKER_SHEET, () => {
        this.setDockExpanded(true);
      });
    },

    selectRenovationType(event) {
      const mode = event.currentTarget.dataset.mode;
      this.setData({ pendingRenderMode: mode });
    },

    collapseDock() {
      if (
        this._openingSheet
        || this.data.keyboardHeight > 0
        || this.data.settingsOpen
        || this.data.pickerVisible
        || this.data.templateSheetOpen
        || this.data.templatePreviewVisible
        || this.data.modePickerVisible
      ) {
        return;
      }
      this.setDockExpanded(false);
    },

    collapseAfterSubmit() {
      this.clearCollapseTimer();
      this.clearKeyboardWait();
      this._openingSheet = false;
      this.setData({ promptFocused: false, keyboardHeight: 0, dockExpanded: false });
      this.triggerEvent('keyboardheightchange', { height: 0 });
      this.triggerEvent('dockexpandchange', { expanded: false });
    },

    onPromptFocus() {
      this.clearCollapseTimer();
      this.setData({ promptFocused: true });
      this.setDockExpanded(true);
    },

    onPromptBlur() {
      if (this._openingSheet) return;
      this.setData({ promptFocused: false });
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

    onTemplateFullEditBlur() {
      this.clearCollapseTimer();
      this._collapseTimer = setTimeout(() => this.collapseDock(), 220);
    },

    onToolbarTap(event) {
      const key = event.currentTarget.dataset.key;
      if (key === 'settings') {
        this.openSettings();
        return;
      }
      if (key === 'template') {
        this.openTemplates();
        return;
      }
      if (key === 'scope' || key === 'model') {
        this.openPicker({ currentTarget: { dataset: { type: key } } });
      }
    },

    openSettings() {
      if (!this.data.view) return;
      const proceed = () => openSheet(this, SETTINGS_SHEET);
      if (this.data.modePickerVisible) {
        this._settingsReturnTarget = 'mode-picker';
        closeSheet(this, MODE_PICKER_SHEET, proceed);
        return;
      }
      this.runAfterKeyboardHidden(proceed);
    },

    closeSettings() {
      closeSheet(this, SETTINGS_SHEET, () => {
        if (this._settingsReturnTarget === 'mode-picker') {
          this._settingsReturnTarget = '';
          openSheet(this, MODE_PICKER_SHEET);
          return;
        }
        this.restorePromptFocus();
      });
    },

    applySettings() {
      this.commitPendingRenderMode();
      closeSheet(this, SETTINGS_SHEET, () => {
        if (this._settingsReturnTarget === 'mode-picker') {
          this._settingsReturnTarget = '';
          openSheet(this, MODE_PICKER_SHEET);
          return;
        }
        this.restorePromptFocus();
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
      const title = buildComposerPickerTitle(type);
      const options = buildComposerPickerOptions(type, view);
      if (!options.length) return;
      const nested = this.data.settingsOpen;
      const proceed = () => {
        this.holdDockExpanded();
        this.setData({
          pickerType: type,
          pickerTitle: title,
          pickerOptions: options,
        });
        openSheet(this, PICKER_SHEET);
      };
      if (nested) {
        proceed();
        return;
      }
      if (this.data.modePickerVisible) {
        this._pickerReturnTarget = 'mode-picker';
        closeSheet(this, MODE_PICKER_SHEET, proceed);
        return;
      }
      this.runAfterKeyboardHidden(proceed);
    },

    openScopePicker() {
      this.openPicker({ currentTarget: { dataset: { type: 'scope' } } });
    },

    closePicker() {
      this.finishPicker({ refocus: !this.data.settingsOpen });
    },

    finishPicker({ refocus }) {
      closeSheet(this, PICKER_SHEET, () => {
        this.setData({ pickerType: '', pickerOptions: [] });
        if (this._pickerReturnTarget === 'mode-picker') {
          this._pickerReturnTarget = '';
          openSheet(this, MODE_PICKER_SHEET);
          return;
        }
        if (refocus) {
          this.restorePromptFocus();
          return;
        }
        this.finishSheetWithoutRefocus();
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
      this.finishPicker({ refocus: !this.data.settingsOpen });
    },

    uploadReference() {
      if (!this.data.view || this.properties.uploading) return;
      const canAdd = this.data.pendingRenderMode === 'whole_floor_plan'
        ? this.data.view.canAddReference
        : this.data.view.singleModeCanAddReference;
      if (!canAdd) return;
      this.commitPendingRenderMode();
      this.holdDockExpanded();
      this.triggerEvent('uploadreference');
    },

    previewControl() {
      const url = this.data.view && this.data.view.controlPreviewUrl;
      if (!url) return;
      this.holdDockExpanded();
      wx.previewImage({ urls: [url], current: url });
    },

    previewFloorPlanReference() {
      const url = String(this.properties.floorPlanPreviewUrl || '');
      if (!url) return;
      wx.previewImage({ urls: [url], current: url });
    },

    previewReferenceImage(event) {
      const referenceIndex = Number(event.currentTarget.dataset.referenceIndex);
      const references = (this.data.view && this.data.view.referenceAssets) || [];
      const current = references[referenceIndex] && references[referenceIndex].previewUrl;
      if (!current) return;
      const urls = [];
      if (this.data.pendingRenderMode === 'whole_floor_plan' && this.data.view?.wholeHouseAvailable) {
        urls.push(String(this.properties.floorPlanPreviewUrl || ''));
      }
      references.forEach((item) => urls.push(String(item.previewUrl || '')));
      wx.previewImage({
        current,
        urls: [...new Set(urls.filter(Boolean))],
      });
    },

    openTimelineControl() {
      const url = this.data.view && this.data.view.timelineControlUrl;
      if (url) {
        this.holdDockExpanded();
        wx.previewImage({ urls: [url], current: url });
        return;
      }
      this.uploadReference();
    },

    removeReference(event) {
      const { id } = event.currentTarget.dataset;
      this.holdDockExpanded();
      this.triggerEvent('removereference', { id });
    },

    openTemplates() {
      const nested = this.data.settingsOpen;
      const proceed = () => {
        this.holdDockExpanded();
        this.triggerEvent('opentemplates');
      };
      if (this.data.modePickerVisible) {
        // The round-setup sheet sits above the template sheet. Swap the panels
        // instead of stacking their masks, then restore this exact setup state
        // after the user applies or cancels a template selection.
        this._templateReturnTarget = 'mode-picker';
        closeSheet(this, MODE_PICKER_SHEET, proceed);
        return;
      }
      if (nested) {
        proceed();
        return;
      }
      this.runAfterKeyboardHidden(proceed);
    },

    closeTemplates() {
      this.setData({ templatePreviewVisible: false, templatePreview: null });
      this._refocusAfterTemplate = this._templateReturnTarget !== 'mode-picker'
        && !this.data.settingsOpen;
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
      const returningToConfig = this._templateReturnTarget === 'mode-picker';
      this._refocusAfterTemplate = !returningToConfig && !this.data.settingsOpen && !this.properties.timelineMode;
      if (this.properties.timelineMode && !returningToConfig) this.setDockExpanded(false);
      this.triggerEvent('selecttemplate', { template });
      this.closeTemplates();
    },

    clearTemplate() {
      const draft = {
        ...(this.properties.draft || {}),
        templateId: '',
        templateName: '',
        templatePreviewUrl: '',
        templateBasePrompt: '',
        templateEditMode: '',
      };
      this.triggerEvent('draftchange', { draft });
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
        const reason = this.data.view?.blockedReason || '';
        if (reason === '请先选择设计方式' || reason === '请先添加现场图' || reason === '请先选择具体房间') {
          this.openModePicker();
          return;
        }
        if (reason === '请输入提示词') {
          this.setDockExpanded(true);
          this.setData({ promptFocused: true });
          return;
        }
        if (reason === '请选择模型' || reason === '当前分辨率不可用') {
          this.openSettings();
          return;
        }
        if (reason) wx.showToast({ title: reason, icon: 'none' });
        return;
      }
      this.triggerEvent('submit');
    },

    noop() {},
  },
});

const { ChatController, initial, appendPatch } = require('../lib/chat');
const chatResume = require('../lib/chat-resume');
const { goToLogin } = require('../../../utils/session');
const { resolveServiceEntryUrl, serviceEntryCode } = require('../../../utils/service-entry');
const nativePreview = require('../../../utils/native-preview');
const { MediaController } = require('../lib/media');
const { ReferenceImage } = require('../lib/reference-image');
const { RecommendationController, PortfolioImages } = require('../lib/portfolio');
const { NearbyLocationController } = require('../lib/location');
const { latestDesignerCard } = require('../lib/client');
const { SiteRecordMedia } = require('../lib/site-records');
const { PublicChatController, initialPublic } = require('../lib/public-sites');
const { LiveConsentController, initialLive } = require('../lib/public-live');
const { ownerLiveAuthorizationPath } = require('../../../utils/owner-live-authorization');
const { PlanChatController, initialPlans } = require('../lib/plans');
const { SpeechController } = require('../lib/speech');
const { FloorplanContextController, initialContext } = require('../lib/floorplan-context');
const { FollowupController, FollowupRecordMedia, initialFollowups } = require('../lib/followups');
const { initialEnterprise, enterpriseMethods } = require('../../../utils/assistant-followup-enterprise');
const { settingsPageMethods } = require('../../../utils/assistant-followup-settings');
const { historyPageMethods } = require('../../../utils/assistant-report-history');
const { planPageMethods } = require('../../../utils/assistant-report-plan');
const { FollowupChat, emptyFollowupChat, followupChatMethods } = require('../lib/followup-chat');
const { ReportQuestionController, reportQuestionMethods, emptyReportQuestion } = require('../lib/report-context');
const { initialOwnerReminder, ownerReminderMethods } = require('./owner-reminders');
const { inputCandidates } = require('../lib/stage-chat-experience');
const { ownerSiteContext } = require('../lib/owner-site-context');
const { measureIntent, measureInvite } = require('../lib/measure-card');
const { initialReplyActions, replyActionsMethods } = require('./reply-actions');
const { initialMessageActions, messageActionsMethods } = require('./message-actions');
const { promotionMethods } = require('./promotion-entry');
const { ReplyScroll } = require('./reply-scroll');
const api = require('../../../utils/api');

function sessionToken() {
	const app = getApp();
	return app.globalData.token || wx.getStorageSync('token') || '';
}

const consultationSpeechPath = id => '/miniprogram/assistant/conversations/' + id + '/speech';

function ownerReportLink(options = {}) {
	const { ownerReport, bindingId, projectId, leadId, recordId, revision } = options;
	const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value);
	if (![ownerReport, bindingId, projectId, leadId, revision].every(validId) || (recordId !== undefined && !validId(recordId))
		|| !Number.isSafeInteger(Number(revision))) return null;
	return { reportId: ownerReport, bindingId, projectId, leadId, revision: Number(revision), recordId };
}

module.exports = () => ({
	...enterpriseMethods,
	...settingsPageMethods,
	...historyPageMethods,
	...planPageMethods,
	...ownerReminderMethods,
	...followupChatMethods,
	...reportQuestionMethods,
	...replyActionsMethods,
	...messageActionsMethods,
	...promotionMethods,
	data: {
		...initial(), navigationTop: 47, navigationHeight: 44, navigationRight: 100,
		...initialOwnerReminder(),
		...initialPublic(), reportQuestion: emptyReportQuestion(),
		...initialLive(),
		...initialPlans(),
		...initialReplyActions(),
		...initialMessageActions(),
		expandedAnswerProcessId: '',
		...initialContext(),
		...initialFollowups(), ...initialEnterprise(), followupChat: emptyFollowupChat(), followupScrollTarget: '', professionalFollowup: false, followupHistoryOpen: false, followupManageOpen: false, followupOriginalPaths: {}, followupOriginalError: '',
		viewportHeight: 844, keyboardHeight: 0, inputFocused: false, bottomInset: 34, sheet: '', sheetOpen: false,
		embedded: false, scrollTarget: '', replyScrollTop: 0, showReplyEnd: false, reconnectingChat: false,
		topics: [
			{ title: '旧房改造', helper: '从哪开始', icon: 'requirement-home', text: '旧房改造有哪些需要先考虑？' },
			{ title: '装修风格', helper: '找找灵感', icon: 'requirement-style', text: '想聊聊适合我家的装修风格' },
			{ title: '预算安排', helper: '先聊想法', icon: 'requirement-budget', text: '想聊聊装修预算怎么安排' },
		],
		siteContext: null, siteTopics: [], siteGreeting: '', stageExperience:null, inputCandidates:[], stageInputCursor:-1, followQuestions:[], followMessageId:'',
		measureCardVisible: false, measureCardDismissed: false,
		mediaItems: [], mediaPaths: {}, mediaLoading: false, mediaBusy: false, mediaPending: false, mediaError: '', mediaKind: 0, mediaRoom: '',
		formalPlans: [], formalRooms: [], formalIndex: 0, formalRoomIndex: 0, mediaPendingFormal: false,
		portfolioReplyId: '', portfolioItems: [], portfolioImages: {}, portfolioError: '', portfolioNotice: '', portfolioLoading: false,
		latestDesignerMessageId: '',
		designerCardImages: {}, designerCardPortraits: {}, designerCardError: '',
		promotionEntry: null, promotionResumedLeadId: '', promotionSubmitting: false,
	},

	onLoad(options) {
		this._ownerReport = ownerReportLink(options);
		const resumeConversationId = this._ownerReport ? '' : chatResume.resumeId(options);
		this._options = options || {};
		if (resumeConversationId && !this._options.conversationId) this._options.conversationId = resumeConversationId;
		this._alive = true;
		const promotionCode = serviceEntryCode(this._options.promotionCode);
		if (promotionCode) this.preparePromotion(promotionCode);
		this._replyScroll = new ReplyScroll(this);
		this.speechController = new SpeechController({ identity: sessionToken, emit: patch => { if (this._alive && this._shown) this.setData(patch); },
			getDraft: () => this.data.draft || '', setDraft: text => { this.clearStageInput(); this.controller.input(text); },
			reload: () => this.controller.refresh() });
		this.measureWindow();
		this.referenceImages = new ReferenceImage();
		this.siteRecords = new SiteRecordMedia({ identity: sessionToken, emit: patch => { if (this._alive && this._shown) this.setData(patch); } });
		this.recommendations = new RecommendationController({ identity: sessionToken, emit: patch => { if (this._alive) this.setData(patch); } });
		this._designerCardConversation = ''; this._designerCardKey = '';
		this.controller = new ChatController({
			identity: sessionToken,
			resumeConversationId,
			onResumeInvalid: id => chatResume.clear(id),
			prepareFirstSend: (cid, emptyLocation) => this.location?.ensure(cid, false, emptyLocation),
			referenceImage: value => this.referenceImages.materialize(value),
			emit: patch => {
				if (!this._alive) return;
				if (patch.conversation?.id) {
					if (patch.conversation.status === 'open') chatResume.save(patch.conversation.id);
					else chatResume.clear(patch.conversation.id);
				}
				if (patch.fatal || patch.needsLogin || patch.conversation === null
					|| patch.conversation?.id && this.speechController.visible && this.speechController.base !== consultationSpeechPath(patch.conversation.id)) {
					this.speechController.hide();
				}
				if (patch.fatal || patch.needsLogin || patch.conversation === null || patch.conversation?.id && patch.conversation.id !== this.data.conversation?.id) {
					if (patch.fatal || patch.needsLogin) patch.promotionResumedLeadId = '';
					this.closeMessageMenu();
					if (this.data.sheet === 'messageShare') this.closeSheet();
					patch.expandedAnswerProcessId = '';
					patch.replyVersionChoice = {};
					patch.replyAudioId = '';
					patch.replyAudioState = '';
				}
				if (patch.messages && this.data.messageMenu && !patch.messages.some(item => item.id === this.data.messageMenu.id && item.editableQuestion))
					this.closeMessageMenu();
				if (patch.messages && this.data.messageShare && !patch.messages.some(item => item.id === this.data.messageShare.id && item.editableQuestion))
					this.closeSheet();
				if (patch.messages && this.data.replyAudioId && !patch.messages.some(item => item.id === this.data.replyAudioId && item.replyActions))
					this.speechController.stopPlayback();
				if (patch.conversation && Object.prototype.hasOwnProperty.call(patch.conversation,'stageExperience')) {
					patch.stageExperience = patch.conversation.stageExperience;
					if (patch.conversation.id !== this.data.conversation?.id
						|| JSON.stringify(patch.stageExperience?.lexicon) !== JSON.stringify(this.data.stageExperience?.lexicon)) {
						this._inputMatch = null;
						Object.assign(patch, { inputCandidates: [], stageInputCursor: -1 });
					}
				}
				if (patch.fatal || patch.needsLogin || patch.conversation===null) {
					patch.expandedAnswerProcessId = '';
					this._inputMatch = null;
					Object.assign(patch, { stageExperience: null, inputCandidates: [], stageInputCursor: -1, followQuestions: [], followMessageId: '' });
					this._followReceipt='';
				}
				const previous = this.data.messages;
				this.setData(appendPatch(patch, previous.length), () => {
					if (patch.fatal || patch.needsLogin) {
						if (this.liveConsent) this.liveConsent.clear();
						if (this.floorplans) this.floorplans.clear();
						this.siteRecords.clear();
						this.recommendations.clear(); this.setData({ portfolioReplyId: '' });
						this.resetDesignerCards();
						if (this.publicSites) this.publicSites.clear();
						if (this.plans) this.plans.clear();
						this.referenceImages.clear();
						if (this.media) this.media.dispose(); this.media = null;
						this.setData({ mediaPaths: {}, mediaItems: [], sheet: '', siteContext: null, siteTopics: [], siteGreeting: '', stageExperience: null, inputCandidates: [], followQuestions: [], followMessageId: '' });
					} else if (patch.messages) {
						if (this._shown && this.liveConsent) this.liveConsent.load(this.controller.conversationId);
						if (this._shown) this.siteRecords.load(this.controller.conversationId, patch.messages);
						if (this._shown && this.publicSites) this.publicSites.load(this.controller.conversationId, this.data.enterpriseId, patch.messages);
						if (this._shown && this.plans) this.plans.load(this.controller.conversationId, patch.messages);
						if (this._shown) this.loadDesignerCards(patch.messages);
						this.loadMessageImages(patch.messages);
						this.maybeShowMeasureCard(patch.messages);
						const replyId = this.data.portfolioReplyId;
						if (replyId && !patch.messages.some(message => message.id === replyId && message.discovery?.works)) {
							this.recommendations.clear(); this.setData({ portfolioReplyId: '' });
						}
					}
					if (patch.conversation === null) { if (this.liveConsent) this.liveConsent.clear(); if (this.floorplans) this.floorplans.clear(); this.recommendations.clear(); this.setData({ portfolioReplyId: '' }); this.resetDesignerCards(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); }
					if (patch.conversation?.id && this.floorplans && this._shown && this.floorplans.id !== String(patch.conversation.id)) this.floorplans.show(String(patch.conversation.id));
					if (patch.conversation !== undefined && !this.data.followupActive) this.syncReportQuestion();
					if (patch.messages || patch.conversation || patch.generating===false) void this.loadStageFollowQuestions();
					const next = patch.messages;
					const appended = next?.length && next[next.length - 1].id !== previous.at(-1)?.id;
					const pendingTurn = patch.sending && patch.pendingText;
					if (pendingTurn) this._replyScroll.reset();
					const managed = this._replyScroll.sync();
					if (!this._holdAutoScroll && (pendingTurn || appended && (!managed || next.at(-1).isUser))) {
						this.scrollBottom();
					}
				});
			},
		});
		this.floorplans = new FloorplanContextController({ client: this.controller.client, identity: sessionToken,
			emit: patch => { if (this._alive) this.setData(patch); } });
		this.followups = new FollowupController({ client: this.controller.client, identity: sessionToken,
			headers: async () => {
				if (this._ownerReport) return { 'X-Assistant-Entry': this._ownerReportToken };
				if (this._options.followup === '1') return {};
				const entry = await this.controller.ensureEntry(); return entry ? { 'X-Assistant-Entry': entry.entryToken } : {};
			},
			emit: patch => {
				if (!this._alive) return;
				const wasActive = this.data.followupActive;
				this.setData(patch, () => {
					if (wasActive && patch.followupActive === false && this._shown && !this.data.followupEnterpriseBusy) {
						if (this.data.professionalFollowup && !this.data.staffTab) { this.setData({ followupManageOpen: false, followupHistoryOpen: false }); this.back(); }
						else if (this.data.staffTab) this.setData({ followupManageOpen: false, followupHistoryOpen: false });
						else { this.controller.visible = true; this.setData({ followupManageOpen: false, followupHistoryOpen: false }); this.controller.refresh({ forceEntry: false, background: true }); }
					}
					if (patch.followupReports || patch.followupActive !== undefined) this.observeFollowupCards();
					if (patch.followupContext && patch.followupActive !== false) this.followupChatController?.open(patch.followupContext);
					if (patch.followupContext === null || patch.followupActive === false) this.followupChatController?.hide();
					if (patch.followupDetail && !patch.followupDetail.readAt) wx.nextTick(() => { if (this._alive && this._shown) this.followups.renderedReport(); });
					if (patch.followupOriginal === null && this.followupMedia) this.followupMedia.clear();
					if (patch.followupOriginal && this.followupMedia && this.data.followupDetail && (this.data.followupDetail.sourceContext || this.data.followupContext))
						this.followupMedia.loadOriginal(this.data.followupDetail.sourceContext || this.data.followupContext, this.data.followupDetail, patch.followupOriginal);
					if (patch.followupActive !== undefined) this._replyScroll.sync();
					if (patch.followupActive === false) this.syncReportQuestion();
				});
			} });
		this.followupChatController = new FollowupChat({ Controller: ChatController, Media: MediaController, client: this.controller.client, identity: sessionToken,
			referenceImage: value => this.referenceImages.materialize(value),
			headers: () => this.followups.headers(), emit: patch => { if (this._alive) this.setData(patch, () => this.syncReportQuestion()); } });
		this.reportQuestions = new ReportQuestionController({ client: this.controller.client, identity: sessionToken, headers: () => this.followups.headers(),
			emit: patch => { if (this._alive) this.setData(patch); }, openTopic: async id => {
				this.followups.leave(); this.closeSheet(); this.controller.visible = true; await this.controller.selectConversation(id);
			} });
		this.followupMedia = new FollowupRecordMedia({ identity: sessionToken, headers: () => this.followups.headers(), emit: patch => {
			if (this._alive) this.setData({ ...(patch.siteRecordPaths ? { followupOriginalPaths: patch.siteRecordPaths } : {}),
				...(patch.siteRecordError !== undefined ? { followupOriginalError: patch.siteRecordError } : {}) });
		} });
	},

	async onShow() {
		if (this.data.expandedAnswerProcessId) this.setData({ expandedAnswerProcessId: '' });
		if (!this.liveConsent) this.liveConsent = new LiveConsentController({ identity: sessionToken,
			openPreview: (cid, receipt) => new Promise((resolve, reject) => wx.navigateTo({
				url: '/packages/construction/camera/camera?conversationId=' + encodeURIComponent(cid)
					+ '&liveId=' + encodeURIComponent(receipt.id) + '&versionId=' + encodeURIComponent(receipt.versionId)
					+ '&revision=' + encodeURIComponent(receipt.revision), success: resolve, fail: reject,
			})), emit: p => { if (this._alive && this._shown) this.setData(p); } });
		if (!this.location) this.location = new NearbyLocationController({ identity: sessionToken, client: this.controller.client });
		if (!this.plans) this.plans = new PlanChatController({ identity: sessionToken, client: this.controller.client, emit: p => { if (this._alive && this._shown) this.setData(p); } });
		if (!this.publicSites) this.publicSites = new PublicChatController({ identity: sessionToken, client: this.controller.client, emit: p => { if (this._alive && this._shown) { this.setData(p); if (p.publicDetail) this.liveConsent.entry(this.data.enterpriseId, p.publicDetail.id); else if (p.publicDetail === null) this.liveConsent.set({ publicLiveEntry: null }); } } });
		this._shown = true;
		this._replyScroll?.request();
		if (nativePreview.shownAfterPreview(this)) return;
		const app = getApp();
		if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
		if (!this._alive || !this._shown || await this.showPromotionEntry()) return;
		const currentIdentity = app.globalData.bootstrap?.current?.context || app.globalData.userInfo || {};
		const selectedMode = app.globalData.bootstrap?.current?.mode || currentIdentity.mode;
		if (this._ownerReport) {
			if (!selectedMode || selectedMode === 'customer') {
				await this.readOwnerSiteReport();
				if (this._alive && this._shown && !this._ownerReportAsked && this._options.ask === '1' && this._options.prompt) {
					this._ownerReportAsked = true;
					await this.askOwnerReport(this._options.prompt);
				}
			}
			else this.setData({ ownerSiteReport: true, loading: false, followupActive: true, followupError: '当前身份无法查看这份日报' });
			return;
		}
		if (selectedMode === 'staff') this._options.followup = '1';
		else if (selectedMode === 'customer') { delete this._options.followup; this.setData({ professionalFollowup: false }); }
		if (this._options.followup === '1') {
			this.setData({ professionalFollowup: true, loading: false });
			this.prepareFollowupEnterprise(currentIdentity);
			if (this.data.followupPlatform && !currentIdentity.enterpriseId) { this.followups.hide(); this.setData({ followupActive: true }); return; }
			const staffProjectId = String(this._options.staffProjectId || '');
			await this.followups.show({ autoOpen: true, projectId: /^[1-9]\d*$/.test(staffProjectId) ? staffProjectId : '' }); return;
		}
		return this.showConsultation();
	},

	async showConsultation() {
		const { globalData } = getApp();
		const selectedMode = globalData.bootstrap?.current?.mode || globalData.userInfo?.mode;
		if (this.media && this.media.session !== sessionToken()) {
			this.media.dispose(); this.media = null;
			this.setData({ mediaItems: [], mediaPaths: {}, mediaPending: false, mediaBusy: false, mediaError: '' });
		}
		if (this._alive && this._shown) {
			if ((!selectedMode || selectedMode === 'customer') && !this._options.publicSiteId) this.startOwnerReminderRefresh();
			await this.controller.show(this._options);
			// A current, unchanged message window can resume without a messages patch.
			if (this._alive && this._shown && !this.data.fatal && this.data.messages?.length) this.loadDesignerCards(this.data.messages);
			if (this._alive && this._shown && !this.data.fatal && !this.controller.conversationId) void this.loadOwnerSiteContext();
			if (this._alive && this._shown && !this.data.fatal) await this.floorplans.show(this.controller.conversationId);
			await this.prepareSpeech();
			if (this._alive && this._shown && !this.data.fatal && !this.data.generating && !this.data.readOnly) await this.syncLocation();
			if (this._alive && this._shown && !this.data.fatal && this._options.publicSiteId) {
				const cid = this.controller.conversationId || await this.controller.handoffConversation();
				if (cid && await this.publicSites.attach(cid, this.data.enterpriseId, this._options.publicSiteId, this._options.publicVersionId)) {
					delete this._options.publicSiteId; delete this._options.publicVersionId;
					await this.controller.refresh();
					if (this._options.findDesigner === '1') { delete this._options.findDesigner; await this.openHandoff(); }
				}
			}
			if (this._alive && this._shown && this._options.prompt && !this.data.draft && !this.data.pendingSend && !this.data.fatal) {
				this.controller.input(this._options.prompt); delete this._options.prompt;
			}
			if (this._alive && this._shown) await this.followups.show();
		}
	},

	async loadOwnerSiteContext() {
		if (this.data.staffTab || this.data.professionalFollowup || this.data.followupActive || this._ownerReport) return;
		if (this._options?.publicSiteId || this._options?.followup === '1') return;
		if (this.controller?.conversationId || this.data.messages?.length) return;
		const token = sessionToken();
		if (!token || this._siteContextPending) return;
		if (this._siteContextToken === token && this._siteContextAt && Date.now() - this._siteContextAt < 60000) return;
		this._siteContextPending = true;
		try {
			const list = await api.request('/miniprogram/construction/owner-sites', 'GET', {}, { suppressUnauthorized: true });
			const items = Array.isArray(list?.data?.items) ? list.data.items : [];
			// Only show the site state when the customer has exactly one readable
			// site. Multiple sites stay on the default welcome state instead of
			// guessing which project the conversation belongs to.
			if (items.length !== 1) {
				if (this._alive && this._shown) this.setData({ siteContext: null, siteTopics: [], siteGreeting: '', stageExperience: null, inputCandidates: [], followQuestions: [], followMessageId: '' });
				this._siteContextToken = token; this._siteContextAt = Date.now();
				return;
			}
			const home = await api.request(`/miniprogram/construction/owner-sites/${encodeURIComponent(items[0].id)}`, 'GET', {}, { suppressUnauthorized: true });
			if (!this._alive || !this._shown || sessionToken() !== token || this.controller?.conversationId) return;
			const view = ownerSiteContext(home?.data?.project, home?.data?.report);
			if (!view) {
				this.setData({ siteContext: null, siteTopics: [], siteGreeting: '', stageExperience: null, inputCandidates: [], followQuestions: [], followMessageId: '' });
				this._siteContextToken = token; this._siteContextAt = Date.now();
				return;
			}
			this.setData({stageExperience:null,...view});
			this._siteContextToken = token; this._siteContextAt = Date.now();
		} catch (error) {
			if (this._alive && this._shown) this.setData({ siteContext: null, siteTopics: [], siteGreeting: '', stageExperience: null, inputCandidates: [], followQuestions: [], followMessageId: '' });
		} finally {
			this._siteContextPending = false;
		}
	},

	openOwnerSite() {
		if (!this.data.siteContext) return;
		const app = getApp();
		app.globalData.customerTab = 'service';
		const pages = getCurrentPages();
		const page = pages && pages[pages.length - 1];
		if (page && page.route === 'pages/index/index' && typeof page.setData === 'function') {
			page.setData({ customerTab: 'service' });
			const tabBar = page.getTabBar && page.getTabBar();
			if (tabBar && tabBar.syncSelected) tabBar.syncSelected();
			return;
		}
		wx.switchTab({ url: '/pages/index/index' });
	},

	onHide() { if (nativePreview.hiddenByPreview(this)) return; this.closeMessageMenu(); this.stopOwnerReminderRefresh(); if (this.liveConsent) this.liveConsent.clear(); this._shown = false; this._replyScroll?.suspend(); this.followupChatController?.hide(); this._enterpriseEpoch = (this._enterpriseEpoch || 0) + 1; this.followups.hide(); if (this._followupObserver) this._followupObserver.disconnect(); clearTimeout(this._followupObserveTimer); this.setData({ ...initialEnterprise(), followupHistoryOpen: false, followupManageOpen: false }); if (this.speechController) this.speechController.hide(); if (this.location) this.location.clear(); this.controller.hide(); this.siteRecords.clear(); this.recommendations.clear(); this.resetDesignerCards(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); this.closeSheet(); this.setData({ speechBusy: false, keyboardHeight: 0, siteRecordPaths: {}, siteRecordError: '', ...initialPublic(), ...initialPlans() }); },
	onUnload() {
		this._alive = false; this._replyScroll?.reset(); clearTimeout(this._sheetTimer);
		clearTimeout(this._copyAnswerTimer); clearTimeout(this._historySearchTimer);
		this.stopOwnerReminderRefresh();
		if (this.liveConsent) this.liveConsent.clear();
		this.followupChatController?.dispose();
		this._enterpriseEpoch = (this._enterpriseEpoch || 0) + 1;
		clearTimeout(this._followupObserveTimer); if (this.followupMedia) this.followupMedia.clear();
		if (this.followups) this.followups.hide(); if (this._followupObserver) this._followupObserver.disconnect();
		if (this.floorplans) this.floorplans.clear();
		if (this.speechController) this.speechController.hide();
		if (this.location) this.location.clear();
		this.controller.dispose();
		this.siteRecords.clear();
		this.referenceImages.clear();
		this.recommendations.clear();
		this.resetDesignerCards();
		if (this.publicSites) this.publicSites.clear();
		if (this.plans) this.plans.clear();
		if (this.media) this.media.dispose();
	},
	onResize() { this.closeMessageMenu(); if (!this.data.keyboardHeight) this.measureWindow(); },
	measureWindow() {
		const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
		let capsule;
		try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) { capsule = null; }
		// Center the two-line brand beside the native capsule, never through it.
		const navigationHeight = Math.max(44, capsule && capsule.height || 32);
		const capsuleTop = capsule && capsule.top || info.statusBarHeight || 24;
		this.setData({
			viewportHeight: info.windowHeight,
			bottomInset: info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 34,
			navigationTop: Math.max(info.statusBarHeight || 24, capsuleTop + ((capsule && capsule.height || 32) - navigationHeight) / 2),
			navigationHeight,
			navigationRight: Math.max(96, info.windowWidth - (capsule && capsule.left || info.windowWidth - 96) + 10),
		}, () => this._replyScroll?.request());
	},
	syncKeyboardTab() {
		const page = getCurrentPages().slice(-1)[0];
		const tab = this.data.staffTab ? page?.getTabBar?.() : page?.selectComponent?.('#customer-nav');
		if (this.data.embedded && tab) tab.setData({ keyboardHidden: !!this.data.keyboardHeight || !!this.data.sheet });
	},
	keyboardChange(event) {
		const keyboardHeight = Math.max(0, Number(event.detail.height) || 0);
		if (!keyboardHeight) this._inputMatch = null;
		this.setData({ keyboardHeight, ...(keyboardHeight ? { ownerReminderPrompt: null }
			: this.data.keyboardHeight ? { inputFocused: false, inputCandidates: [], stageInputCursor: -1 } : {}) }, () => this._replyScroll?.request());
		this.syncKeyboardTab();
		if (!this._replyScroll?.turn && (this.data.messages.length || this.data.pendingText)) this.scrollBottom();
	},
	focusInput(event) {
		const entering = !this.data.inputFocused;
		this.setData({ inputFocused: true, ownerReminderPrompt: null });
		if (entering && this.data.draft) this.updateStageInput(event?.detail?.cursor);
	},
	blurInput() {
		if (this.data.keyboardHeight) return;
		this.clearStageInput();
		this.setData({ inputFocused: false });
	},
	input(event) {
		this.controller.input(event.detail.value);
		this.updateStageInput(event.detail.cursor);
	},
	updateStageInput(cursor) {
		const draft = this.data.draft || '';
		const match = inputCandidates(draft, cursor, this.data.stageExperience?.lexicon, this.data.maxChars);
		this._inputMatch = match && { ...match, draft };
		this.setData({ inputCandidates: match?.items || [], stageInputCursor: -1 });
	},
	clearStageInput() {
		this._inputMatch = null;
		if (this.data.inputCandidates?.length || this.data.stageInputCursor !== -1)
			this.setData({ inputCandidates: [], stageInputCursor: -1 });
	},
	fillStageQuestion(event) {
		const match = this._inputMatch;
		const word = event.currentTarget.dataset.text;
		const draft = this.data.draft || '';
		if (!match?.items.includes(word) || match.draft !== draft || !this.data.stageExperience?.lexicon?.includes(word)
			|| !this.data.canSend || this.data.readOnly || this.data.busy || this.data.pendingSend || this.data.generating) return;
		this.controller.input(draft.slice(0, match.start) + word + draft.slice(match.end));
		this._inputMatch = null;
		this.setData({ inputCandidates: [], stageInputCursor: match.start + word.length });
		this.queueKeyboardScroll?.();
	},
	stageFollowReply() {
		const latest = this.data.messages?.at(-1);
		if (!this.data.stageExperience || this.data.stageExperience.followUp === 'off' || this.data.readOnly
			|| this.data.fatal || this.data.followupActive || this.data.generating || this.data.pendingSend
			|| latest?.authorKind !== 'assistant' || latest.available === false) return null;
		return latest;
	},
	async loadStageFollowQuestions() {
		const cid = this.controller?.conversationId;
		const latest = this.stageFollowReply();
		if (!cid || !latest) {
			this._followReceipt = '';
			if (this.data.followMessageId) this.setData({ followQuestions: [], followMessageId: '' });
			return;
		}
		const key = cid + ':' + latest.id;
		const token = sessionToken();
		if (this._followReceipt === key) return;
		this._followReceipt = key;
		try {
			const result = await this.controller.client.read('/conversations/' + cid + '/suggestions');
			if (!this._alive || !this._shown || this._followReceipt !== key || sessionToken() !== token
				|| this.controller.conversationId !== cid || this.stageFollowReply()?.id !== latest.id) return;
			const questions = String(result.messageId || '') === String(latest.id) ? result.questions || [] : [];
			this.setData({ followMessageId: questions.length ? String(latest.id) : '', followQuestions: questions });
		} catch (_) { if (this._followReceipt === key) this._followReceipt = ''; }
	},
	pickStageFollowQuestion(event) {
		const reply = this.stageFollowReply();
		const { text, message } = event.currentTarget.dataset;
		if (!reply || String(reply.id) !== String(message) || String(message) !== this.data.followMessageId
			|| !this.data.followQuestions.includes(text)) return;
		return this.pickPrompt(event);
	},
	async pickPrompt(event) {
		if (this._promptSending) return;
		if (this.data.needsLogin) return this.send();
		if (!this.data.canSend || this.data.loading || this.data.busy || this.data.pendingSend || this.data.pendingAction
			|| this.data.generating || this.data.uncertainRun || this.data.readOnly || this.data.fatal
			|| this.data.contextBusy || this.data.contextPending || this.data.speechBusy || this._openingVoice) return;
		this._promptSending = true;
		try {
			if (this.data.messageQuote) this.controller.setMessageQuote();
			this.controller.input(event.currentTarget.dataset.text);
			return await this.send();
		} finally { this._promptSending = false; }
	},
	chooseOption(event) { return this.controller.chooseOption(event.currentTarget.dataset.key, event.currentTarget.dataset.text); },
	confirmOptions() { return this.controller.confirmOptions(); },
	async send() {
		this.clearStageInput();
		if (this.data.needsLogin) { this.login(); return; }
		if (this.data.contextBusy || this.data.contextPending || this.data.sending) return;
		if (this.data.speechBusy || this._openingVoice) return;
		if (!this.data.staffTab && !this.data.followupActive && !this.data.siteContext && measureIntent(this.data.draft)) {
			this.setData({ measureCardVisible: true, measureCardDismissed: false });
		}
		if (!this._alive || !this._shown || this._openingVoice || this.data.speechBusy) return;
		const speech = this.speechController;
		const path = speech ? this.speechPath() : '';
		this.controller.speechInput = path && speech.matches(path) ? speech.binding() : undefined;
		try { return await this.controller.send(); }
		finally {
			this.controller.speechInput = null;
			if (path && path === this.speechPath() && speech.matches(path) && !this.data.pendingSend) await speech.afterSend();
		}
	},
	async planDecision(e) {
		const { id, action } = e.currentTarget.dataset;
		let reason = '';
		if (action === 'request-changes') {
			const result = await new Promise(resolve => wx.showModal({ title: '希望怎样修改', content: this.plans.reason(String(id)), editable: true, placeholderText: '说明需要调整的内容', success: resolve, fail: () => resolve({ confirm: false }) }));
			if (!result.confirm || !String(result.content || '').trim()) return;
			reason = String(result.content).trim();
		}
		if (await this.plans.decide(String(id), action, reason)) {
			if (action !== 'preview') await this.controller.refresh();
			this.scrollBottom();
		}
	},
	async retryPlan() { if (await this.plans.retry()) await this.controller.refresh(); },
	previewPlan(e) { return this.plans.preview(String(e.currentTarget.dataset.id)); },
	cancelSiteWatch(e) { return this.controller.cancelSiteWatch(e.currentTarget.dataset.message); },
	previewSiteRecord(e) { const d = e.currentTarget.dataset; return this.siteRecords.preview(String(d.record), Number(d.version), String(d.media)); },
	refresh() { return this.controller.refresh(); },
	async reconnectChat() {
		if (!this.data.connectionInterrupted || this.data.reconnectingChat || this.data.loading || this.data.busy) return;
		this.setData({ reconnectingChat: true });
		try { await this.refresh(); }
		finally { if (this._alive) this.setData({ reconnectingChat: false }); }
	},
	async openFloorplanPicker() {
		if (this.data.contextBusy || this.data.generating || this.data.pendingSend || this.data.pendingAction || this.data.readOnly) return;
		const id = this.controller.conversationId || await this.controller.handoffConversation();
		if (!id || !this._alive || !this._shown) return;
		this.setData({ contextBrowseOnly: false }); this.openSheet('floorplan');
		await this.floorplans.show(id);
	},
	async browseFloorplan() {
		if (this.data.contextBusy) return;
		await this.openFloorplanPicker();
		this.setData({ contextBrowseOnly: true });
		if (this.floorplans.selected && this.data.sheet === 'floorplan') await this.floorplans.detail(this.floorplans.selected);
	},
	viewFloorplan(event) {
		const plan = this.data.contextItems[Number(event.currentTarget.dataset.index)];
		if (plan) return this.floorplans.detail(plan);
	},
	floorplanList() { this.setData({ contextDetail: null }); },
	async chooseFloorplan(event) {
		const index = event.currentTarget.dataset.index;
		const plan = index === 'detail' ? this.data.contextDetail : index === 'none' ? null : this.data.contextItems[Number(index)];
		if (index !== 'none' && !plan || this.data.contextBusy || this.data.readOnly || this.data.generating || this.data.pendingSend || this.data.pendingAction) return;
		if (await this.floorplans.select(plan)) this.closeSheet();
	},
	async reloadFloorplanContext() {
		if (this.floorplans.id) return this.floorplans.retry();
		return this.openFloorplanPicker();
	},
	openFullArchive() {
		const plan = this.data.contextDetail;
		if (plan) wx.navigateTo({ url: '/packages/business/customer-project/customer-project?leadId=' + encodeURIComponent(plan.leadId) });
	},
	login() { goToLogin(); },
	scanServiceCode() {
		if (!this.data.needsServiceCode && !this.data.promotionEntry?.rescan) return;
		wx.scanCode({ onlyFromCamera: false, success: result => {
			const url = resolveServiceEntryUrl(result, { assistant: true });
			const code = serviceEntryCode(url.split('?entryCode=')[1]);
			if (code) void this.beginPromotion(code);
			else wx.showToast({ title: '请扫描装修企业的推广码', icon: 'none' });
		} });
	},
	back() {
		wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
	},
	scrollBottom() {
		if (this.data.messageMenu) return;
		this.setData({ scrollTarget: '' }, () => this.setData({ scrollTarget: 'conversation-end' }));
	},
	watchReplyScroll() { if (!this.data.messageMenu) this._replyScroll?.request(); },
	pauseReplyScroll() { this._replyScroll?.hold(); },
	jumpToReplyEnd() { this._replyScroll?.jump(); },
	scrollBottomSettled(attempt = 0) {
		if (!this._alive || !this._shown) { this._holdAutoScroll = false; return; }
		// Wait for the closing system message to finish layout before the single
		// jump; scrolling in the message-update callback stops at the old height.
		setTimeout(() => {
			if (!this._alive || !this._shown) { this._holdAutoScroll = false; return; }
			this.scrollBottom();
			if (attempt >= 2) { this._holdAutoScroll = false; return; }
			setTimeout(() => {
				if (!this._alive || !this._shown) { this._holdAutoScroll = false; return; }
				const query = wx.createSelectorQuery();
				query.select('.conversation-scroll').boundingClientRect();
				query.select('#conversation-end').boundingClientRect();
				query.exec(([view, end]) => {
					if (!this._alive || !this._shown) { this._holdAutoScroll = false; return; }
					if (!view || !end || end.top > view.bottom + 2) this.scrollBottomSettled(attempt + 1);
					else this._holdAutoScroll = false;
				});
			}, 150);
		}, 100);
	},
	openSheet(sheet) {
		this.clearStageInput();
		wx.hideKeyboard(); clearTimeout(this._sheetTimer);
		this.setData({ sheet, sheetOpen: false, keyboardHeight: 0, inputFocused: false }, () => {
			this.syncKeyboardTab();
			this._sheetTimer = setTimeout(() => this.setData({ sheetOpen: true }), 25);
		});
	},
	async openMedia() {
		if (this.data.mediaBusy || this.data.stageExperience?.attachments === false) return;
		this.clearStageInput();
		wx.hideKeyboard();
		let id = this.data.conversation && this.data.conversation.id;
		if (!id) id = await this.controller.handoffConversation();
		if (!id || !this._alive) return;
		if (!this.media || this.media.id !== id) {
			if (this.media) this.media.dispose();
			this.media = new MediaController({ identity: sessionToken, emit: p => { if (this._alive) this.setData(p); } });
			this.setData({ formalPlans: [], formalRooms: [], formalIndex: 0, formalRoomIndex: 0, mediaRoom: '', mediaError: '' });
		}
		await this.media.load(id);
		if (!this.data.mediaError) this.pickImage();
	},
	mediaKind(event) { if (!this.data.mediaPending && !this.data.mediaBusy) this.setData({ mediaKind: Number(event.detail.value) }); },
	mediaRoom(event) { if (!this.data.mediaPending && !this.data.mediaBusy) this.setData({ mediaRoom: event.detail.value }); },
	async pickImage() {
		if (!this.media || this.data.mediaBusy || this.data.mediaPending || this.data.readOnly || !this.data.canSend) return;
		const owner = this.media, session = sessionToken();
		wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
			success: async result => {
				if (!this._alive || session !== sessionToken() || owner !== this.media) return;
				const file = result.tempFiles[0];
				if (!file || file.size > 4 * 1024 * 1024) { this.setData({ mediaError: '请选择4MB以内的JPEG或PNG图片。' }); return; }
				const ok = await owner.upload(file.tempFilePath, 'image', '');
				if (ok && this._alive) { await owner.load(owner.id); await this.controller.refresh(); }
			},
			fail: error => { if (this._alive && !String(error.errMsg).includes('cancel')) this.setData({ mediaError: '未能选择图片，请检查相册或相机权限后重试。' }); },
		});
	},
	async retryMedia() {
		if (!this.media) return;
		if (this.data.mediaPending) {
			const ok = this.data.mediaPendingFormal ? await this.media.attachFormal() : await this.media.upload();
			if (ok) { await this.media.load(this.media.id); await this.controller.refresh(); }
		} else await this.media.load(this.media.id);
	},
	previewMedia(event) { return this.media && this.media.preview(event.currentTarget.dataset.id); },
	loadFormalPlans() { return this.media && this.media.floorPlans(); },
	formalPlanChange(event) {
		const index = Number(event.detail.value);
		this.setData({ formalIndex: index, formalRoomIndex: 0, formalRooms: [{ id: '', name: '完整户型' }, ...(this.data.formalPlans[index]?.rooms || [])] });
	},
	formalRoomChange(event) { this.setData({ formalRoomIndex: Number(event.detail.value) }); },
	async attachFormal() {
		if (!this.media || this.data.mediaBusy || this.data.mediaPending) return;
		const plan = this.data.formalPlans[this.data.formalIndex], room = this.data.formalRooms[this.data.formalRoomIndex];
		if (!plan || !room) return;
		if (await this.media.attachFormal(plan, room.id)) { await this.media.load(this.media.id); await this.controller.refresh(); }
	},
	removeMedia(event) {
		const owner = this.media, id = event.currentTarget.dataset.id;
		wx.showModal({ title: '删除这张图片？', content: '删除后，本次会话和接待人将无法再次读取。', success: result => {
			if (result.confirm && this._alive && owner === this.media) owner.remove(id).then(() => this.controller.refresh());
		} });
	},
	closeSheet() {
		clearTimeout(this._sheetTimer);
		if (this.data.sheet === 'messageShare') this.setData({ messageShare: null, messageShareBusy: false, messageShareError: '' });
		const closingInteraction = ['history', 'answerFeedback', 'answerMore'].includes(this.data.sheet);
		if (closingInteraction && this.data.interactionKeyboard) wx.hideKeyboard();
		if (this.data.sheet === 'history') this.resetHistorySearch();
		const closingReminder = this.data.sheet === 'ownerReminder';
		if (closingReminder) this._ownerReminderTarget = null;
		if (this.data.sheet === 'publicSite' && this.publicSites) this.publicSites.closeDetail();
		this.controller.citationRequest = (this.controller.citationRequest || 0) + 1;
		this.followupChatController?.clearCitation();
		this.followups?.clearSource();
		this.referenceImages.clear();
		this.controller.set({ citation: null });
		this.setData({ sheetOpen: false });
		this._sheetTimer = setTimeout(() => {
			if (this._alive) { this.setData({ sheet: '', ...(closingReminder ? initialOwnerReminder() : {}), ...(closingInteraction ? { interactionKeyboard: 0, replyTarget: '', feedbackNote: '', feedbackError: '' } : {}) }); this.syncKeyboardTab(); }
		}, 260);
	},
	swallow() {},
	async loadMessageImages(messages) {
		const id = this.controller.conversationId;
		if (!id || (!messages.some(m => m.mediaId) && !this.controller.client.pending.has('media:' + id) && !this.controller.client.pending.has('media-formal:' + id))) return;
		if (!this.media || this.media.id !== id) {
			if (this.media) this.media.dispose();
			this.setData({ mediaPaths: {} });
			this.media = new MediaController({ identity: sessionToken, emit: p => { if (this._alive) this.setData(p); } });
			await this.media.load(id);
		}
		const owner = this.media, session = sessionToken();
		for (const message of messages.filter(m => m.mediaId)) {
			const path = message.mediaAvailable ? await owner.thumbnail(message.mediaId) : '';
			if (!this._alive || owner !== this.media || session !== sessionToken()) return;
			this.setData({ ['mediaPaths.' + message.mediaId]: path });
		}
	},
	openHistory() {
		this.resetHistorySearch();
		this.openSheet('history'); this.followups.loadList();
		return this.data.professionalFollowup ? null : this.controller.loadHistory();
	},
	selectFollowup(event) {
		if (this.data.busy || this.data.pendingSend || this.data.pendingAction || this.data.mediaBusy || this.data.mediaPending) return;
		this.setData({ followupHistoryOpen: false, followupManageOpen: false }); this.closeSheet(); this.controller.hide(); return this.followups.select(String(event.currentTarget.dataset.id));
	},
	async readOwnerSiteReport() {
		const report = this._ownerReport, session = sessionToken();
		const ticket = this._ownerReportTicket = (this._ownerReportTicket || 0) + 1;
		const current = () => this._alive && this._shown && this._ownerReportTicket === ticket && sessionToken() === session;
		this.setData({ ownerSiteReport: true, loading: false, followupActive: true, followupLoading: true, followupError: '' });
		try {
			const entry = await this.controller.client.read('/entry-context', { leadId: report.leadId }, {}, 'POST');
			if (!current()) return;
			this._ownerReportToken = entry.entryToken;
			await this.followups.show({ report });
		} catch (_) {
			if (current()) this.setData({ followupLoading: false, followupError: '这份日报暂时无法打开' });
		}
	},
	async askOwnerReport(prompt) {
		if (!prompt) return;
		const entry = this.followupChatController;
		const ready = () => {
			const state = entry?.state;
			return entry?.visible && state && !state.loading && !state.fatal && state.conversation?.status === 'open'
				&& this.data.followupContext && this.reportQuestions?.canChange();
		};
		for (let i = 0; i < 40; i++) {
			if (!this._alive || !this._shown) return;
			if (ready()) break;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (!this._alive || !this._shown || !ready()) return;
		delete this._options.prompt; delete this._options.ask;
		let text = prompt;
		try { text = decodeURIComponent(prompt); } catch (_) { /* Keep the supplied question when it is already plain text. */ }
		entry.input(text);
		// The page-opening route loads one report detail rather than the report
		// list, so select that exact report before sending the prefilled question.
		const selected = await this.askFollowupReport({ currentTarget: { dataset: {} } });
		if (selected) await this.sendFollowup();
	},
	refreshFollowup() { return this._ownerReport ? this.readOwnerSiteReport() : this.followups.select(this.followups.selected); },
	readFollowupReport(event) { const d = event.currentTarget.dataset; this.setData({ followupManageOpen: false }); return this.followups.readReport(String(d.report), Number(d.revision), this.followups.selected, d.project ? String(d.project) : ''); },
	closeFollowupReport() { this.followups.closeReport(); if (this._ownerReport) this.back(); },
	moreFollowupReports() { return this.followups.more(); },
	recoverFollowup() { return this.followups.recover(); },
	retryFollowupReport(event) { const d = event?.currentTarget?.dataset, r = this.followups.sourceReport(d?.report ? String(d.report) : '', Number(d?.revision)); if (r?.generationRetryable) return this.followups.retryBody(r); },
	openReportSource(event) {
		const data = event.currentTarget.dataset, pid = String(data.project), rid = data.report ? String(data.report) : '', revision = Number(data.revision);
		const owner = this.followups, epoch = owner.epoch, d = owner.sourceReport(rid, revision);
		const sources = d?.projects?.find(p => p.id === pid)?.knowledgeSources || [];
		const open = source => { if (!owner.current(epoch) || owner.sourceReport(rid, revision) !== d || !source) return; this.openSheet('reportSource'); return owner.readSource(pid, source.sourceId, rid, revision); };
		if (sources.length === 1) return open(sources[0]);
		if (sources.length > 1) wx.showActionSheet({ itemList: sources.map(s => s.title), success: result => open(sources[result.tapIndex]) });
	},
	retryReportSource() { return this.followups.loadSource(); },
	openReportSourceFile() { return this.followups.openSourceFile(); },
	readFollowupOriginal(event) { return this.followups.original(String(event.currentTarget.dataset.project), String(event.currentTarget.dataset.record)); },
	closeFollowupOriginal() { this.setData({ followupOriginal: null }); this.followups.set({ followupOriginal: null }); },
	previewFollowupOriginal(event) { const r = this.data.followupOriginal; if (r) return this.followupMedia.preview(r.id, r.version, String(event.currentTarget.dataset.media)); },
	observeFollowupCards() {
		if (this._followupObserver) this._followupObserver.disconnect();
		if (!this._alive || !this._shown || !this.data.followupActive || !this.data.followupReports.length) return;
		clearTimeout(this._followupObserveTimer);
		if (this.data.sheet) { this._followupObserveTimer = setTimeout(() => this.observeFollowupCards(), 300); return; }
		wx.nextTick(() => {
			if (!this._alive || !this._shown || !this.data.followupActive || this.data.followupDetail || !wx.createIntersectionObserver) return;
			this._followupObserver = wx.createIntersectionObserver(this, { observeAll: true, thresholds: [0.5] });
			this._followupObserver.relativeTo('.followup-scroll').observe('.followup-card-marker', r => {
				if (r.intersectionRatio >= 0.5 && this._shown && !this.data.sheet && !this.data.followupDetail && !this.data.followupHistoryOpen && !this.data.followupManageOpen)
					this.followups.visibleCard(String(r.dataset.report));
			});
		});
	},
	openRequirements() {
		if (!this.data.conversation?.requirementProposalPending || this.data.conversation.mode !== 'ai'
			|| this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
		wx.navigateTo({ url: '/packages/assistant/requirements/requirements?conversationId=' + encodeURIComponent(this.data.conversation.id) });
	},
	maybeShowMeasureCard(messages) {
		if (this.data.staffTab || this.data.professionalFollowup || this.data.followupActive || this.data.readOnly
			|| this.data.siteContext || this.data.measureCardDismissed || this.data.measureCardVisible) return;
		if (!Array.isArray(messages) || !messages.length) return;
		const latest = messages[messages.length - 1];
		if (!latest || latest.authorKind !== 'assistant') return;
		const text = (latest.blocks || []).map(block => block.text || '').join('');
		if (measureInvite(text)) this.setData({ measureCardVisible: true });
	},

	async bookMeasure() {
		if (this.data.handoffBusy || this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
		this.setData({ measureCardVisible: false });
		await this.openHandoff();
	},

	dismissMeasure() {
		this.setData({ measureCardVisible: false, measureCardDismissed: true });
	},

	async openHandoff() {
		const conversation = this.data.conversation;
		if (conversation && ['human', 'handoff_requested'].includes(conversation.mode)) {
			this.setData({ scrollTarget: '' }, () => {
				if (this._alive && this._shown) this.setData({ scrollTarget: 'handoff-state' });
			});
			return;
		}
		return this.controller.handoff();
	},
	async contactKeeper(event) {
		const { project, message } = event.currentTarget.dataset;
		const phone = await this.controller.constructionContact(String(project), String(message));
		if (!phone || !this._alive || !this._shown) return;
		wx.makePhoneCall({ phoneNumber: phone, fail: error => {
			if (this._alive && !/cancel/i.test(error.errMsg || '')) wx.showToast({ title: '电话未拨出，请重试', icon: 'none' });
		} });
	},
	endHandoff() {
		const waiting = this.data.conversation?.mode === 'handoff_requested';
		wx.showModal({ title: waiting ? '取消等待？' : '结束接续？', content: '结束后设计师将无法继续查看本次咨询，小K恢复回复。',
			success: async result => {
				if (!result.confirm || !this._alive) return;
				// Hold the message-driven auto scroll: it fires before the closing
				// system message has its final height and would stop halfway.
				this._holdAutoScroll = true;
				await this.controller.handoff(waiting ? 'cancel' : 'end');
				if (!this._alive || !this._shown) { this._holdAutoScroll = false; return; }
				if (this.data.conversation?.mode === 'ai') this.scrollBottomSettled();
				else this._holdAutoScroll = false;
			} });
	},
	speechPath() {
		const id = this.data.conversation?.id;
		return this._alive && this._shown && !this.data.fatal && !this.data.followupActive && id && id === this.controller.conversationId
			? consultationSpeechPath(id) : '';
	},
	async prepareSpeech() {
		const path = this.speechPath();
		if (!path) return false;
		const speech = this.speechController;
		if (!speech.matches(path)) await speech.show(path);
		return path === this.speechPath() && speech.matches(path);
	},
	async voiceInput() {
		if (!this._alive || !this._shown || this.data.followupActive) return;
		if (this.data.needsLogin) { this.login(); return; }
		if (this._openingVoice || !this.data.canSend || this.data.loading || this.data.fatal || this.data.readOnly || this.data.busy
			|| this.data.pendingSend || this.data.pendingAction || this.data.generating || this.data.uncertainRun || this.data.speechBusy) return;
		this.clearStageInput();
		wx.hideKeyboard();
		this._openingVoice = true;
		try {
			const id = this.controller.conversationId || await this.controller.handoffConversation();
			if (id && id === this.controller.conversationId && await this.prepareSpeech()) await this.speechController.microphone();
		} finally { this._openingVoice = false; }
	},
	async voiceMessage(event) {
		const messageId = String(event.currentTarget.dataset.message);
		if (!this.data.staffTab && !this.data.professionalFollowup && !this.data.ownerSiteReport && this.controller.questionText(messageId))
			return this.openMessageMenu(messageId);
		if (await this.prepareSpeech() && this.speechController.items.some(asset => asset.messageId === String(messageId)))
			return this.speechController.messageMenu(messageId);
	},
	moreHistory() { return this.controller.loadHistory(true); },
	async selectHistory(event) {
		if (this.data.mediaBusy || this.data.mediaPending) return;
		if (this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
		const { id, anchor } = event.currentTarget.dataset;
		if (anchor) this._holdAutoScroll = true;
		this.followups.leave(); this.controller.visible = true; this.closeSheet();
		try {
			await this.controller.selectConversation(id);
			if (id !== this.controller.conversationId) return;
			if (anchor) {
				const found = await this.controller.findHistoryMessage(anchor);
				if (this._alive && this._shown && id === this.controller.conversationId) {
					if (found) {
						const version = this.data.messages.find(item => item.id === anchor)?.replyVersion;
						this.setData({ scrollTarget: '', ...(version ? { ['replyVersionChoice.r' + version.root]: anchor } : {}) },
							() => this.setData({ scrollTarget: 'message-' + anchor }));
					}
					else { this.scrollBottom(); wx.showToast({ title: '该消息暂不可查看', icon: 'none' }); }
				}
			}
			await this.prepareSpeech();
		} finally {
			if (anchor) this._holdAutoScroll = false;
		}
	},
	async newConversation() {
		if (this.data.mediaBusy || this.data.mediaPending) return;
		if (this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
		chatResume.clear();
		delete this._options.conversationId;
		this.setData({ measureCardVisible: false, measureCardDismissed: false });
		this.followups.leave(); this.closeSheet();
		await this.controller.newConversation();
		if (!this.controller.visible) await this.controller.show(this._options);
		if (this._alive && this._shown && !this.data.fatal && !this.controller.conversationId) {
			this._siteContextAt = 0;
			await this.loadOwnerSiteContext();
		}
	},
	olderMessages() { return this.controller.olderMessages(); },
	stop() { return this.controller.action('cancel'); },
	toggleAnswerProcess(event) {
		const messageId = String(event.currentTarget.dataset.message);
		const process = this.data.messages.find(message => message.id === messageId)?.answerProcess;
		if (!process || !(process.steps.length || process.sources.length)) return;
		this.setData({ expandedAnswerProcessId: this.data.expandedAnswerProcessId === messageId ? '' : messageId });
	},
	retryRun() { return this.controller.action('retry'); },
	confirmAction() { return this.controller.action(this.data.pendingAction); },
	archive() {
		if (!this.data.conversation || this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
		wx.showModal({
			title: '结束这段对话？', content: '正在生成的回答会停止，记录仍可在历史对话中查看。', confirmText: '结束对话',
			success: result => { if (result.confirm && this._alive) this.controller.action('archive'); },
		});
	},
	openCitation(event) {
		this._citationId = event.currentTarget.dataset.id;
		this.openSheet('citation'); return this.controller.openCitation(this._citationId);
	},
	retryCitation() { return this.controller.openCitation(this._citationId); },
	async syncLocation(requestPermission = false) {
		const cid = this.data.conversation?.id, session = sessionToken();
		if (!cid || !this.location || this.data.generating || this.data.readOnly || this.data.busy || this.data.pendingSend || this.data.pendingAction || this.data.uncertainRun) return {};
		const result = await this.location.ensure(cid, requestPermission);
		if (!this._alive || !this._shown || cid !== this.data.conversation?.id || session !== sessionToken()) return {};
		// Reproject in the background like the idle poll: it never supersedes an
		// in-flight write with a new epoch and never re-reads the entry token.
		const idle = () => this._alive && this._shown && cid === this.data.conversation?.id && session === sessionToken()
			&& !this.controller.state.busy && !this.controller.state.pendingSend && !this.controller.state.pendingAction && !this.controller.state.generating;
		if (result.changed && idle()) {
			const epoch = this.controller.epoch;
			await this.controller.snapshot(cid, epoch, true).catch(error => {
				if (idle()) this.controller.syncFailure(error, cid, epoch);
			});
		}
		return result;
	},
	async loadDesigners(event) {
		const replyId = event.currentTarget.dataset.message, cid = this.controller.conversationId, session = sessionToken();
		const valid = () => this._alive && this._shown && cid === this.controller.conversationId && session === sessionToken()
			&& this.data.messages.some(message => message.id === replyId && (message.discovery?.works || message.designerDiscovery));
		if (!valid() || this._locatingDesigners || this.data.busy || this.data.generating) return;
		this._locatingDesigners = true;
		if (replyId !== this.data.portfolioReplyId) this.recommendations.clear();
		this.setData({ portfolioReplyId: replyId, portfolioLoading: true });
		try {
			const location = await this.syncLocation(true);
			if (!valid()) return;
			if (!location.blocked) await this.recommendations.load(cid, true, replyId);
			if (valid() && location.notice && !this.data.portfolioItems.length) this.setData({ portfolioNotice: location.notice });
		} finally { this._locatingDesigners = false; if (valid()) this.setData({ portfolioLoading: false }); }
	},
	resetDesignerCards() {
		if (this.designerCardMedia) this.designerCardMedia.clear();
		this.designerCardMedia = null; this._designerCardConversation = ''; this._designerCardKey = '';
		if (this._alive) this.setData({ latestDesignerMessageId: '', designerCardImages: {}, designerCardPortraits: {}, designerCardError: '' });
	},
	async loadDesignerCards(messages) {
		if (!this._alive) return;
		const latest = latestDesignerCard(messages);
		const conversationId = this.controller.conversationId;
		if (this._designerCardConversation !== conversationId) {
			if (this.designerCardMedia) this.designerCardMedia.clear();
			this.designerCardMedia = conversationId ? new PortfolioImages(this.controller.client) : null;
			this._designerCardConversation = conversationId; this._designerCardKey = '';
			this.setData({ designerCardImages: {}, designerCardPortraits: {}, designerCardError: '' });
		}
		const key = latest ? String(latest.id) : '';
		this.setData({ latestDesignerMessageId: key });
		if (key === this._designerCardKey) return;
		this._designerCardKey = key;
		if (!latest || !conversationId || !this.designerCardMedia) return;
		const owner = this.designerCardMedia, session = sessionToken();
		const valid = () => this._alive && owner === this.designerCardMedia && session === sessionToken()
			&& this._designerCardKey === key && this.controller.conversationId === conversationId;
		for (const card of latest.designerRecommendation.items) {
			if (!this.data.designerCardImages['i' + card.work.coverAssetId]) {
				try {
					const filePath = await owner.load(conversationId, card.work, card.work.coverAssetId);
					if (!valid()) return;
					this.setData({ ['designerCardImages.i' + card.work.coverAssetId]: filePath });
				} catch (error) {
					if (!valid()) return;
					if ([401, 403, 404].includes(error.statusCode)) { this.setData({ designerCardImages: {}, designerCardPortraits: {} }); this._designerCardKey = ''; return; }
					this.setData({ designerCardError: '部分作品图片暂未加载，点此重试。' });
				}
			}
			if (card.portraitAvailable && !this.data.designerCardPortraits[card.authorId]) {
				try {
					const filePath = await owner.loadPortrait(conversationId, card.authorId);
					if (!valid()) return;
					this.setData({ ['designerCardPortraits.' + card.authorId]: filePath });
				} catch (_) { if (!valid()) return; }
			}
		}
	},
	retryDesignerCards() {
		this.setData({ designerCardError: '' });
		this._designerCardKey = '';
		return this.loadDesignerCards(this.data.messages);
	},
	openCardDesigner(event) {
		const data = event.currentTarget.dataset, id = this.controller.conversationId;
		if (!id || !/^[1-9]\d{0,18}$/.test(String(data.id))) return;
		wx.navigateTo({ url: `/packages/assistant/designer/designer?conversationId=${encodeURIComponent(id)}&authorId=${encodeURIComponent(data.id)}&sourceWorkId=${encodeURIComponent(data.work || '')}` });
	},
	openCardWork(event) {
		const data = event.currentTarget.dataset, id = this.controller.conversationId;
		if (!id || !/^[1-9]\d{0,18}$/.test(String(data.work)) || !/^[1-9]\d{0,18}$/.test(String(data.version))) return;
		wx.navigateTo({ url: `/packages/assistant/work/work?conversationId=${encodeURIComponent(id)}&workId=${encodeURIComponent(data.work)}&versionId=${encodeURIComponent(data.version)}` });
	},
	async browseSites(event) {
		if (this._browsingSites || this.data.publicLoading || this.data.publicBusy || this.data.loading || this.data.fatal || this.data.busy || this.data.generating || this.data.pendingSend || this.data.pendingAction || this.data.uncertainRun) return;
		const cid = this.controller.conversationId, eid = this.data.enterpriseId, session = sessionToken();
		const replyId = event?.currentTarget?.dataset.message || this.data.publicReplyId;
		const valid = () => this._alive && this._shown && cid === this.controller.conversationId && session === sessionToken()
			&& this.data.messages.some(message => message.id === replyId && message.discovery?.sites);
		if (!cid || !eid || !valid()) return;
		this._browsingSites = true;
		try {
			const location = await this.syncLocation(true);
			if (!valid() || location.blocked) return;
			await this.publicSites.browse(cid, eid, this.data.messages, location.notice, replyId);
			if (valid() && replyId === this.data.messages.at(-1)?.id) this.scrollBottom();
		} finally { this._browsingSites = false; }
	},
	openPublicSite(e) {
		const d = e.currentTarget.dataset;
		if (!this.controller.conversationId || this.data.fatal || !/^[1-9]\d{0,18}$/.test(String(d.id)) || !/^[1-9]\d{0,18}$/.test(String(d.version))) return;
		this.openSheet('publicSite');
		return this.publicSites.openDetail(this.controller.conversationId, this.data.enterpriseId, String(d.id), String(d.version));
	},
	async askPublicSite() {
		const item = this.data.publicDetail, cid = this.controller.conversationId;
		if (!item || this._askingPublicSite || !this.data.canSend || this.data.publicDetailLoading || this.data.publicBusy || this.data.publicPending || this.data.loading || this.data.fatal || this.data.readOnly || this.data.busy || this.data.generating || this.data.pendingSend || this.data.pendingAction || this.data.uncertainRun || this.data.contextBusy || this.data.contextPending || this.data.speechBusy) return;
		this._askingPublicSite = true;
		try {
			if (await this.publicSites.attach(cid, this.data.enterpriseId, item.id, item.versionId)) {
				if (!this._alive || !this._shown || cid !== this.controller.conversationId) return;
				this.closeSheet(); await this.controller.refresh(); this.scrollBottom();
			}
		} finally { this._askingPublicSite = false; }
	},
	async publicDecision(e) {
		const d = e.currentTarget.dataset;
		const ok = await this.publicSites.decide(d.key, d.action);
		if (ok && d.action !== 'preview') await this.controller.refresh();
	},
	async liveDecision(e) {
		if (!this.liveConsent || this.data.readOnly) return;
		const d = e.currentTarget.dataset;
		if (d.action === 'preview') {
			const card = this.liveConsent.card(String(d.id));
			const url = card?.canDecide && ownerLiveAuthorizationPath(card.projectId, card);
			if (url) {
				wx.navigateTo({ url, fail: () => wx.showToast({ title: '暂时无法打开直播申请', icon: 'none' }) });
				return;
			}
		}
		if (await this.liveConsent.decide(String(d.id), d.action) && d.action !== 'preview') await this.controller.refresh();
	},
	stopPublicLive(e) {
		if (this.data.liveBusy || this.data.livePending || this.data.readOnly) return;
		const id = String(e.currentTarget.dataset.id);
		wx.showModal({ title: '停止公开直播', content: '仅停止这路直播，照片和服务记录的授权不变。', confirmText: '停止公开', success: async r => { if (r.confirm && await this.liveConsent.decide(id, 'withdraw')) await this.controller.refresh(); } });
	},
	retryLiveConsent() { return this.liveConsent.retry(); },
	watchPublicLive() {
		const item = this.data.publicLiveEntry;
		if (!item || !/^[a-f0-9]{48}$/.test(item.key)) return;
		wx.navigateTo({ url: '/packages/construction/public-live/public-live?enterpriseId=' + this.data.enterpriseId + '&key=' + item.key + '&conversationId=' + this.controller.conversationId + '&siteId=' + this.data.publicDetail.id + '&versionId=' + this.data.publicDetail.versionId });
	},
	publicLiveTab(e) { this.setData({ publicLiveTab: e.currentTarget.dataset.tab }); },
	publicLiveDesigner() {
		const item = this.data.publicDetail, cid = this.controller.conversationId;
		if (!this._alive || !this._shown || this.data.sheet !== 'publicSite' || !item || this.data.publicDetailLoading || this.data.publicDetailError || this.data.publicBusy || this.data.publicPending || this.data.loading || this.data.fatal || this.data.readOnly) return;
		if (![this.data.enterpriseId, item.id, item.versionId].every(value => /^[1-9]\d{0,18}$/.test(String(value))) || cid && !/^[1-9]\d{0,18}$/.test(String(cid))) return;
		const values = { ...(cid ? { conversationId: cid } : {}), publicEnterpriseId: this.data.enterpriseId, publicSiteId: item.id, publicVersionId: item.versionId, findDesigner: '1' };
		wx.navigateTo({ url: '/packages/assistant/chat/chat?' + Object.keys(values).map(key => key + '=' + encodeURIComponent(values[key])).join('&') });
	},
	laterPublic() { this.publicSites.later(); },
	async retryPublic() {
		if (this.data.publicPending) { if (await this.publicSites.retry()) { if (this.data.sheet === 'publicSite') this.closeSheet(); await this.controller.refresh(); } }
		else if (this.data.sheet === 'publicSite') await this.publicSites.readDetail();
		else if (this.data.publicBrowsing) await this.browseSites();
		else await this.controller.refresh();
	},
	previewPublic(e) { return this.publicSites.media.preview(e.currentTarget.dataset.key); },
	previewPublicDetail(e) { return this.publicSites.detailMedia.preview(e.currentTarget.dataset.key); },
	openDesigner(event) {
		const item = this.data.portfolioItems.find(i => i.authorId === String(event.currentTarget.dataset.id));
		if (!item || !this.data.conversation) return;
		wx.navigateTo({ url: `/packages/assistant/designer/designer?conversationId=${encodeURIComponent(this.data.conversation.id)}&authorId=${item.authorId}&sourceWorkId=${item.work.id}` });
	},
	onShareAppMessage() {
		const token = this.data.shareReferenceEntry;
		return { title: '聊聊你的装修想法 · 家客来小K', path: token ? '/packages/assistant/chat/chat?referenceEntry=' + encodeURIComponent(token) : '/pages/index/index',
			imageUrl: '/packages/assistant/assets/chat-notebook-mascot.png' };
	},
});

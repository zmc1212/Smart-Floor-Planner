const ownerReminders = require('../../../utils/owner-reminders');

const initialOwnerReminder = () => ({ ownerReminderPrompt: null, ownerReminderDetail: null,
  ownerReminderLoading: false, ownerReminderError: '' });
const refreshInterval = 45000;

const ownerReminderMethods = {
  startOwnerReminderRefresh() {
    this.stopOwnerReminderRefresh();
    const token = ownerReminders.sessionToken();
    if (token) void this.refreshOwnerReminder(this._ownerReminderVisit, token);
  },
  stopOwnerReminderRefresh() {
    this._ownerReminderVisit = (this._ownerReminderVisit || 0) + 1;
    clearTimeout(this._ownerReminderTimer);
    this._ownerReminderTarget = null;
    if (this.data.ownerReminderPrompt || this.data.ownerReminderDetail || this.data.ownerReminderLoading || this.data.ownerReminderError)
      this.setData(initialOwnerReminder());
  },
  canPromptOwnerReminder() {
    const { inputFocused, keyboardHeight, sheet, followupActive, ownerReminderPrompt } = this.data;
    return !inputFocused && !keyboardHeight && !sheet && !followupActive && !ownerReminderPrompt;
  },
  async refreshOwnerReminder(visit, token) {
    const current = () => this._alive && this._shown && this._ownerReminderVisit === visit && ownerReminders.sessionToken() === token;
    try {
      const summary = await ownerReminders.refreshSummary();
      if (!current() || !summary?.next || !this.canPromptOwnerReminder()) return;
      const prompt = await ownerReminders.claimPrompt(summary.next);
      if (prompt && current() && this.canPromptOwnerReminder()) this.setData({ ownerReminderPrompt: prompt });
    } catch (_) {
      // Refresh failures are retried while chat is visible. The project inbox
      // remains the recovery path if a prompt write succeeded without a reply.
    } finally {
      if (current()) this._ownerReminderTimer = setTimeout(() => this.refreshOwnerReminder(visit, token), refreshInterval);
    }
  },
  dismissOwnerReminder() { this.setData({ ownerReminderPrompt: null }); },
  openOwnerReminder() {
    const target = this.data.ownerReminderPrompt;
    if (!target || this.data.sheet) return;
    this._ownerReminderTarget = target;
    this.setData(initialOwnerReminder());
    this.openSheet('ownerReminder');
    return this.readOwnerReminder();
  },
  async readOwnerReminder() {
    const target = this._ownerReminderTarget, token = ownerReminders.sessionToken();
    if (!target || this.data.ownerReminderLoading) return;
    const current = () => this._alive && this._shown && this._ownerReminderTarget === target && ownerReminders.sessionToken() === token;
    this.setData({ ownerReminderLoading: true, ownerReminderError: '' });
    try {
      const detail = await ownerReminders.read(target);
      if (current()) this.setData({ ownerReminderDetail: detail });
    } catch (error) {
      if (current()) this.setData({ ownerReminderError: ownerReminders.readError(error) });
    } finally {
      if (current()) this.setData({ ownerReminderLoading: false });
    }
  },
};

module.exports = { initialOwnerReminder, ownerReminderMethods };

const { errorCopy } = require('./client');

const initialMeasureBooking = () => ({
  measureBookingLoading: false,
  measureBookingError: '',
  measureBookingBusy: false,
  measureBookingPending: false,
  measureProjects: [],
  measureLeadId: '',
  measureLeadName: '',
  measureDates: [],
  measureDate: '',
  measureSlots: [],
  measureSlotsLoading: false,
  measureSlotsExpanded: false,
  measureSlot: null,
  measureSlotHeading: '',
  measureAddress: '',
  measureLocation: null,
  measureAppointment: null,
  measureAppointmentLabel: '',
  measureAppointmentMeta: '',
  measurePhone: '',
  measureContactEditable: false,
});

function nextDates(maxAdvanceDays) {
  const count = Math.max(1, Math.min(5, Number(maxAdvanceDays) >= 0 ? Number(maxAdvanceDays) + 1 : 5));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      label: index === 0 ? '今天' : index === 1 ? '明天' : `周${'日一二三四五六'[date.getDay()]}`,
      shortDate: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });
}

function validRead(value) {
  return value && typeof value === 'object' && Array.isArray(value.projects)
    && value.projects.every(project => project && typeof project.leadId === 'string' && typeof project.name === 'string')
    && (value.leadId === null || typeof value.leadId === 'string')
    && (value.appointment === null || value.appointment && typeof value.appointment.id === 'string')
    && Number.isSafeInteger(value.maxAdvanceDays)
    && (typeof value.contactPhone === 'string' || typeof value.phoneMasked === 'string');
}

function validAvailability(value) {
  return value && typeof value === 'object' && Array.isArray(value.slots)
    && value.slots.every(slot => slot && typeof slot.startAt === 'string' && typeof slot.endAt === 'string')
    && Number.isSafeInteger(value.maxAdvanceDays);
}

function slotLabel(slot) {
  const format = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  return `${format(slot.startAt)} - ${format(slot.endAt)}`;
}

function slotHeading(slot) {
  const date = new Date(slot && slot.startAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function appointmentLabel(appointment) {
  if (!appointment) return '';
  const start = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
  const end = new Date(appointment.timeRange.match(/,([^)\]]+)[)\]]/)?.[1].replaceAll('"', '') || '');
  if (Number.isNaN(start.getTime())) return '';
  const time = value => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  return `${start.getMonth() + 1}月${start.getDate()}日 ${time(start)}${Number.isNaN(end.getTime()) ? '' : ' - ' + time(end)}`;
}

function appointmentMeta(appointment) {
  if (!appointment) return '';
  const role = appointment.designerId === appointment.measurerId ? '设计师' : '现场顾问';
  return [appointment.locationName || appointment.address, role + '待确认'].filter(Boolean).join(' · ');
}

class MeasureBookingController {
  constructor({ client, identity, emit }) {
    Object.assign(this, { client, identity, emit });
    this.epoch = 0;
    this.id = '';
    this.view = initialMeasureBooking();
  }
  valid(epoch) { return epoch === this.epoch && this.session === this.identity(); }
  patch(value) {
    this.view = { ...this.view, ...value };
    this.emit(value);
  }
  clear() {
    this.epoch++;
    this.id = '';
    this.flight = null;
    this.patch(initialMeasureBooking());
  }
  async show(id) {
    if (!id) { this.clear(); return false; }
    if (this.flight && this.id === id && this.session === this.identity()) return this.flight;
    const epoch = ++this.epoch;
    this.id = id; this.session = this.identity(); this.view = initialMeasureBooking();
    this.loginPhone = '';
    this.patch({ ...initialMeasureBooking(), measureBookingLoading: true });
    const flight = (async () => {
      try {
        const data = await this.client.read('/conversations/' + id + '/measure-booking');
        if (!this.valid(epoch)) return false;
        if (!validRead(data)) throw { code: 'invalid_response' };
        this.loginPhone = data.contactPhone ?? data.phoneMasked;
        const dates = nextDates(data.maxAdvanceDays);
        this.patch({
          measureProjects: data.projects,
          measureLeadId: data.leadId || '',
          measureLeadName: data.projects.find(project => project.leadId === data.leadId)?.name || '',
          measureAppointment: data.appointment || null,
          measureAppointmentLabel: appointmentLabel(data.appointment),
          measureAppointmentMeta: appointmentMeta(data.appointment),
          measurePhone: this.loginPhone,
          measureContactEditable: typeof data.contactPhone === 'string',
          measureDates: dates,
          measureDate: dates[0] ? dates[0].key : '',
          measureSlots: [],
          measureSlot: null,
          measureAddress: data.appointment ? data.appointment.address : '',
          measureLocation: data.appointment && data.appointment.latitude != null ? {
            locationName: data.appointment.locationName || '',
            latitude: data.appointment.latitude,
            longitude: data.appointment.longitude,
            coordinateSystem: data.appointment.coordinateSystem || 'gcj02',
          } : null,
          measureBookingError: '',
        });
        if (!data.appointment && dates.length) await this.loadSlots(dates[0].key);
        return true;
      } catch (error) {
        if (this.valid(epoch)) this.patch({ measureBookingError: errorCopy(error) });
        return false;
      } finally {
        if (this.valid(epoch)) this.patch({ measureBookingLoading: false });
      }
    })();
    this.flight = flight;
    try { return await flight; } finally { if (this.flight === flight) this.flight = null; }
  }
  async loadSlots(date) {
    if (!this.id || !date) return false;
    const epoch = this.epoch;
    const request = {};
    this.slotRequest = request;
    const needsProject = this.view.measureProjects.length > 1 && !this.view.measureLeadId;
    this.patch({
      measureDate: date, measureSlots: [], measureSlot: null, measureSlotHeading: '', measureBookingError: '',
      measureSlotsLoading: !needsProject, measureSlotsExpanded: false,
    });
    if (needsProject) return false;
    const current = () => this.valid(epoch) && this.slotRequest === request;
    try {
      const query = { date, ...(this.view.measureLeadId ? { leadId: this.view.measureLeadId } : {}) };
      const data = await this.client.read('/conversations/' + this.id + '/measure-booking/availability', query);
      if (!current()) return false;
      if (!validAvailability(data)) throw { code: 'invalid_response' };
      this.patch({ measureSlots: data.slots.map(slot => ({ ...slot, label: slotLabel(slot) })) });
      return true;
    } catch (error) {
      if (current()) this.patch({ measureBookingError: errorCopy(error) });
      return false;
    } finally {
      if (current()) this.patch({ measureSlotsLoading: false });
    }
  }
  selectDate(date) {
    if (this.view.measureBookingPending || this.view.measureBookingBusy) return false;
    return this.loadSlots(date);
  }
  selectSlot(slot) {
    if (this.view.measureBookingPending || this.view.measureBookingBusy || this.view.measureSlotsLoading) return false;
    const current = slot && this.view.measureSlots.find(item => item.startAt === slot.startAt);
    if (!current) return false;
    this.patch({ measureSlot: current, measureSlotHeading: slotHeading(current), measureBookingError: '' });
    return true;
  }
  toggleSlots() { this.patch({ measureSlotsExpanded: !this.view.measureSlotsExpanded }); }
  selectProject(leadId) {
    if (this.view.measureBookingPending || this.view.measureBookingBusy) return false;
    const project = this.view.measureProjects.find(item => item.leadId === String(leadId || ''));
    this.patch({ measureLeadId: String(leadId || ''), measureLeadName: project ? project.name : '', measureSlot: null, measureSlotHeading: '' });
    if (this.view.measureDate) return this.loadSlots(this.view.measureDate);
    return true;
  }
  inputAddress(value) { if (this.view.measureBookingPending) return; this.patch({ measureAddress: String(value || '').slice(0, 300) }); }
  async editContact(prompt) {
    if (!this.view.measureContactEditable || this.view.measureAppointment
      || this.view.measureBookingPending || this.view.measureBookingBusy) return false;
    const epoch = this.epoch;
    const value = await prompt(this.view.measurePhone);
    if (!this.valid(epoch) || value === undefined || this.view.measureBookingPending || this.view.measureBookingBusy) return false;
    const phone = String(value).replace(/[\s-]/g, '').replace(/^(?:\+?86|0086)(?=1[3-9]\d{9}$)/, '');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      this.patch({ measureBookingError: errorCopy({ code: 'appointment_phone_invalid' }) });
      return false;
    }
    this.patch({ measurePhone: phone, measureBookingError: '' });
    return true;
  }
  setLocation(location) {
    this.patch({
      measureLocation: location || null,
      ...(location && location.address && !this.view.measureAddress ? { measureAddress: String(location.address).slice(0, 300) } : {}),
    });
  }
  async submit() {
    const { measureSlot, measureLeadId, measureAddress, measureLocation, measurePhone, measureBookingBusy } = this.view;
    if (measureBookingBusy || !this.id || !measureSlot) return false;
    if (!String(measureAddress || '').trim()) {
      this.patch({ measureBookingError: '请填写上门地址' });
      return false;
    }
    const epoch = this.epoch;
    this.patch({ measureBookingBusy: true, measureBookingError: '' });
    try {
      const data = await this.client.mutate('measure-booking:' + this.id, '/conversations/' + this.id + '/measure-booking', {
        ...(measureLeadId ? { leadId: measureLeadId } : {}),
        startAt: measureSlot.startAt,
        endAt: measureSlot.endAt,
        address: String(measureAddress).trim(),
        ...(measurePhone !== this.loginPhone ? { contactPhone: measurePhone } : {}),
        ...(measureLocation ? { location: measureLocation } : {}),
      });
      if (!this.valid(epoch)) return false;
      if (!data || !data.appointment || typeof data.appointment.id !== 'string') throw { code: 'invalid_response' };
      this.patch({
        measureAppointment: data.appointment,
        measureAppointmentLabel: appointmentLabel(data.appointment),
        measureAppointmentMeta: appointmentMeta(data.appointment),
        measurePhone: data.contactPhone ?? measurePhone,
        measureLeadId: data.leadId || measureLeadId,
        measureBookingPending: false,
        measureSlot: null,
        measureSlotHeading: '',
      });
      return true;
    } catch (error) {
      if (this.valid(epoch)) this.patch({
        measureBookingPending: this.client.pending.has('measure-booking:' + this.id),
        measureBookingError: this.client.pending.has('measure-booking:' + this.id)
          ? '预约结果待核对，请按原时间再确认一次。' : errorCopy(error),
      });
      return false;
    } finally {
      if (this.valid(epoch)) this.patch({ measureBookingBusy: false });
    }
  }
  retry() {
    if (this.client.pending.has('measure-booking:' + this.id)) return this.submit();
    return this.view.measureDate ? this.loadSlots(this.view.measureDate) : this.show(this.id);
  }
}

module.exports = { MeasureBookingController, initialMeasureBooking, nextDates };

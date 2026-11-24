import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AppointmentRepository, ReferralLeadRepository } from '@/db/repositories';
import { AssistantRepository, rows, type Row } from '@/db/repositories/assistant-repository';
import { appointmentToDto, parseAppointmentAddress, parseAppointmentContactPhone, parseAppointmentDateTime, parseAppointmentLocation } from '@/lib/appointment-api';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';
import { fail, id, requireCapability, type ActorContext } from '../contracts';
import { idempotent } from '../core/conversation';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !DATE.test(value)) fail('invalid_message', 422);
  return value;
}

function parseLeadId(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  id(value);
  return String(value);
}

export function parseMeasureBookingBody(input: unknown) {
  const body = input as Row;
  if (!body || Array.isArray(body) || typeof body !== 'object'
    || Object.keys(body).some(key => !['leadId', 'startAt', 'endAt', 'address', 'location', 'contactPhone'].includes(key))) {
    fail('invalid_message', 422);
  }
  return {
    leadId: parseLeadId(body.leadId),
    startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
    endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
    address: parseAppointmentAddress(body.address),
    location: parseAppointmentLocation(body.location),
    contactPhone: parseAppointmentContactPhone(body.contactPhone),
  };
}

function maskPhone(value: unknown) {
  const phone = String(value || '').replace(/\s+/g, '');
  if (!phone) return '';
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export class AssistantMeasureBookingService {
  constructor(
    readonly actor: ActorContext,
    readonly conversationId: string,
    private readonly profile: { name?: string; phone?: string },
    private transaction?: PostgresTransaction
  ) {
    id(conversationId);
    requireCapability(actor, 'assistant.chat.self');
    if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  }
  private get userId() {
    if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
    return this.actor.principal.userId;
  }
  private scope<T>(run: (repo: AssistantRepository, c: Row) => Promise<T>, write = false) {
    const execute = async (tx: PostgresTransaction) => {
      const repo = new AssistantRepository(tx, this.actor);
      await repo.settings(write);
      const c = await repo.conversation(this.conversationId);
      if ((c.entry_snapshot as Row)?.retentionRedacted) fail('assistant_resource_not_found', 404);
      return run(repo, c);
    };
    return this.transaction ? execute(this.transaction) : withTenantTransaction(this.actor.enterpriseId, execute);
  }
  private async projects(repo: AssistantRepository) {
    const list = await rows(repo.tx, sql`select l.id,l.name,l.community_name from app.leads l
      where l.enterprise_id=${this.actor.enterpriseId} and l.customer_user_id=${this.userId}
        and l.archived_at is null and l.status not in ('closed','converted') order by l.id desc limit 20`);
    return list.map(item => ({
      leadId: String(item.id),
      name: String(item.name),
      communityName: item.community_name ? String(item.community_name) : null,
    }));
  }
  read() {
    return this.scope(async repo => {
      const projects = await this.projects(repo);
      const appointments = new AppointmentRepository(repo.tx);
      const current = await appointments.findCurrentForCustomer(BigInt(this.actor.enterpriseId), BigInt(this.userId));
      const settings = await appointments.getSettings(BigInt(this.actor.enterpriseId));
      const contactPhone = current?.contactPhone || this.profile.phone?.trim() || '';
      return {
        projects,
        leadId: current ? String(current.leadId) : projects.length === 1 ? projects[0].leadId : null,
        appointment: current ? appointmentToDto(current) : null,
        contactPhone,
        phoneMasked: maskPhone(contactPhone),
        maxAdvanceDays: settings.maxAdvanceDays,
        durationMinutes: settings.defaultDurationMinutes,
        timezone: settings.timezone,
      };
    });
  }
  availability(input: { date: unknown; leadId?: unknown }) {
    const date = parseDate(input.date);
    const requested = parseLeadId(input.leadId);
    return this.scope(async repo => {
      const projects = await this.projects(repo);
      if (requested && !projects.some(project => project.leadId === requested)) fail('assistant_resource_not_found', 404);
      const leadId = requested || (projects.length === 1 ? projects[0].leadId : null);
      const data = await new AppointmentRepository(repo.tx).listAvailability({
        enterpriseId: BigInt(this.actor.enterpriseId),
        leadId: leadId ? BigInt(leadId) : null,
        date,
      });
      return {
        leadId,
        maxAdvanceDays: data.settings.maxAdvanceDays,
        durationMinutes: data.settings.defaultDurationMinutes,
        timezone: data.settings.timezone,
        slots: data.available.map(slot => ({ startAt: slot.startAt.toISOString(), endAt: slot.endAt.toISOString() })),
      };
    }).catch(error => this.raiseAppointmentError(error));
  }
  async book(requestKey: string, input: unknown) {
    try {
      const body = parseMeasureBookingBody(input);
      let created = false;
      const loginPhone = this.profile.phone?.trim() || '';
      const receipt = await this.scope(async (repo, c) => {
        if (c.status !== 'open' || c.mode !== 'ai') fail('conversation_read_only');
        const projects = await this.projects(repo);
        let leadId = body.leadId;
        if (leadId && !projects.some(project => project.leadId === leadId)) fail('assistant_resource_not_found', 404);
        if (!leadId) {
          if (projects.length === 1) leadId = projects[0].leadId;
          else if (projects.length > 1) fail('appointment_lead_required', 409);
          else {
            if (!loginPhone) fail('appointment_phone_required', 409);
            const project = await new ReferralLeadRepository(repo.tx).createCustomerBookingLead({
              enterpriseId: BigInt(this.actor.enterpriseId),
              customerUserId: BigInt(this.userId),
              name: this.profile.name || '微信客户',
              phone: loginPhone,
            });
            leadId = String(project.lead.id);
          }
        }
        const receipt = await idempotent(repo.tx, this.actor, 'measure-booking:' + this.conversationId, requestKey,
          { ...body, leadId }, async () => {
            const contactPhone = body.contactPhone || loginPhone;
            if (!contactPhone) fail('appointment_phone_required', 409);
            const appointment = await new AppointmentRepository(repo.tx).create({
              enterpriseId: BigInt(this.actor.enterpriseId),
              leadId: BigInt(leadId!),
              startAt: body.startAt,
              endAt: body.endAt,
              address: body.address,
              contactPhone,
              location: body.location,
              actorUserId: BigInt(this.userId),
              eventKey: 'assistant-booking:' + this.conversationId + ':' + requestKey,
            });
            created = true;
            return { leadId: leadId!, contactPhone, appointment: appointmentToDto(appointment) };
          });
        await repo.tx.execute(sql`update app.assistant_conversations
          set entry_snapshot=entry_snapshot-'measureOffer',version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId} and jsonb_exists(entry_snapshot,'measureOffer')`);
        return receipt;
      }, true);
      if (created) await this.notify(receipt as {
        leadId: string;
        contactPhone: string;
        appointment: ReturnType<typeof appointmentToDto>;
      });
      return receipt;
    } catch (error) {
      this.raiseAppointmentError(error);
    }
  }
  /** Repository guards raise coded appointment_* errors; expose them as the
   * assistant contract instead of letting dispatch turn a known 409 into 503. */
  private raiseAppointmentError(error: unknown): never {
    const code = (error as { code?: unknown } | null)?.code;
    const status = Number((error as { status?: unknown } | null)?.status);
    if (typeof code === 'string' && (code.startsWith('appointment_') || code === 'lead_phone_conflict')
      && Number.isInteger(status)) fail(code, status);
    if (status === 400) fail('invalid_message', 422);
    throw error;
  }
  private async notify(receipt: { leadId: string; contactPhone: string; appointment: ReturnType<typeof appointmentToDto> }) {
    const appointment = receipt.appointment;
    const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
    if (Number.isNaN(startAt.getTime())) return;
    await Promise.allSettled([
      notifyAppointmentStaff({
        enterpriseId: BigInt(appointment.enterpriseId),
        leadId: BigInt(receipt.leadId),
        designerId: BigInt(appointment.designerId),
        measurerId: BigInt(appointment.measurerId),
        address: appointment.address,
        contactPhone: receipt.contactPhone,
        startsAt: startAt,
        eventKey: appointment.id,
        eventType: 'created',
      }),
      notifyCustomerOfAppointment({
        enterpriseId: BigInt(appointment.enterpriseId),
        leadId: BigInt(receipt.leadId),
        address: appointment.address,
        contactPhone: receipt.contactPhone,
        startsAt: startAt,
        eventType: 'created',
      }),
    ]);
  }
}

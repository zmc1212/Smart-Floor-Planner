import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';
import { object, shortText } from './contracts';

const wechatPattern = /^[A-Za-z0-9_.-]{1,64}$/;
const phonePattern = /^\+?\d{7,15}$/;

export function storedContact(value: unknown) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
  const wechatId = typeof row.wechatId === 'string' && wechatPattern.test(row.wechatId) ? row.wechatId : '';
  const phone = typeof row.phone === 'string' && phonePattern.test(row.phone) ? row.phone : '';
  const qrImageBase64 = typeof row.qrImageBase64 === 'string' && row.qrImageBase64.length <= 409600
    && /^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(row.qrImageBase64) ? row.qrImageBase64 : '';
  const consentAt = typeof row.consentAt === 'string' && Number.isFinite(Date.parse(row.consentAt)) ? row.consentAt : null;
  const consentBy = typeof row.consentBy === 'string' && /^[1-9]\d*$/.test(row.consentBy) ? row.consentBy : null;
  const consent = Boolean(consentAt && consentBy);
  const publishWechat = consent && row.publishWechat === true && Boolean(wechatId || qrImageBase64);
  const publishPhone = consent && row.publishPhone === true && Boolean(phone);
  return { wechatId, phone, qrImageBase64, publishWechat, publishPhone, consentAt, consentBy,
    allowInApp: row.allowInApp !== false || !(publishWechat || publishPhone) };
}

type StoredContact = ReturnType<typeof storedContact>;

export function contactEditorView(contact: StoredContact) {
  return { wechatId: contact.wechatId, phone: contact.phone, qrAvailable: Boolean(contact.qrImageBase64),
    publishWechat: contact.publishWechat, publishPhone: contact.publishPhone, allowInApp: contact.allowInApp };
}

export function publicContactView(contact: StoredContact, revision: number) {
  return { revision, wechatId: contact.publishWechat ? contact.wechatId : '', phone: contact.publishPhone ? contact.phone : '',
    qrAvailable: contact.publishWechat && Boolean(contact.qrImageBase64), allowInApp: contact.allowInApp };
}

export async function saveContact(value: unknown, previous: StoredContact, actorId: string,
  prepareImage: (raw: unknown) => Promise<string>): Promise<StoredContact> {
  const v = object(value, ['wechatId', 'phone', 'publishWechat', 'publishPhone', 'allowInApp', 'qrImageBase64', 'consent']);
  const wechatId = shortText(v.wechatId, 64), phone = shortText(v.phone, 30).replace(/[\s()-]/g, '');
  if ((wechatId && !wechatPattern.test(wechatId)) || (phone && !phonePattern.test(phone))
    || typeof v.publishWechat !== 'boolean' || typeof v.publishPhone !== 'boolean' || typeof v.allowInApp !== 'boolean'
    || (v.consent !== undefined && typeof v.consent !== 'boolean')) fail('portfolio_contact_invalid', 422);
  const qrImageBase64 = v.qrImageBase64 === undefined ? previous.qrImageBase64
    : v.qrImageBase64 === null ? '' : await prepareImage(v.qrImageBase64);
  if ((v.publishWechat && !wechatId && !qrImageBase64) || (v.publishPhone && !phone)) fail('portfolio_contact_invalid', 422);
  const changedWechat = v.publishWechat && (!previous.publishWechat || wechatId !== previous.wechatId || qrImageBase64 !== previous.qrImageBase64);
  const changedPhone = v.publishPhone && (!previous.publishPhone || phone !== previous.phone);
  const publishing = changedWechat || changedPhone;
  if (publishing && v.consent !== true) fail('portfolio_contact_consent_required', 422);
  return {
    wechatId, phone, qrImageBase64, publishWechat: v.publishWechat, publishPhone: v.publishPhone,
    allowInApp: v.allowInApp || !(v.publishWechat || v.publishPhone),
    consentAt: publishing ? new Date().toISOString() : previous.consentAt,
    consentBy: publishing ? actorId : previous.consentBy,
  };
}

export async function readPortfolioContact(tx: PostgresTransaction, enterpriseId: string, authorId: string) {
  const row = await one(tx, sql`select version,content->'contact' as contact from app.portfolio_profiles
    where enterprise_id=${enterpriseId} and author_id=${authorId} for share`);
  const state = storedContact(row?.contact);
  return { view: publicContactView(state, Number(row?.version || 0)), state };
}

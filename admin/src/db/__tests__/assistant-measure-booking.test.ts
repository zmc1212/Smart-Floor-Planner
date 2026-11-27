import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { closePostgresPool } from '@/lib/postgresql';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { localDateInTimeZone } from '@/lib/appointment-scheduling';
import { AssistantMeasureBookingService } from '@/lib/assistant/booking/appointment';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';

after(closePostgresPool);

test('a booking retry retains the exact slot and current authorization of the original file', async () => {
  const fixture = new D4SharingFixture();
  try {
    await fixture.create();
    const { eid, leadId, conversationId } = fixture;
    const designerId = fixture.memberIds[0];
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.leads
      set assigned_to=${designerId},assignment_status='assigned'
      where enterprise_id=${eid} and id=${leadId}`));
    const booking = new AssistantMeasureBookingService(fixture.actor, conversationId, {});
    const date = localDateInTimeZone(new Date(Date.now() + 86_400_000), 'Asia/Shanghai');
    const { slots: [first, second] } = await booking.availability({ date });
    assert.ok(first && second);

    const key = randomUUID();
    const request = { ...first, address: '测试专用 · 量房地址', contactPhone: '13900123456' };
    const booked = await booking.book(key, request);
    assert.equal(booked.leadId, leadId);
    await assert.rejects(booking.book(key, { ...request, ...second }), { code: 'idempotency_conflict' });

    await withTenantTransaction(eid, async tx => {
      await tx.execute(sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${eid},${fixture.userIds[0]},'测试专用 · 新档案','13900123457','manual')`);
      await tx.execute(sql`update app.assistant_conversations
        set entry_snapshot=jsonb_set(entry_snapshot,'{measureOffer}','{"fixture":"new"}'::jsonb)
        where enterprise_id=${eid} and id=${conversationId}`);
    });
    const replay = await booking.book(key, request);
    assert.equal((replay.appointment as Row).id, (booked.appointment as Row).id);
    const state = await withTenantTransaction(eid, tx => one(tx, sql`select entry_snapshot->'measureOffer' as offer,
      (select count(*)::int from app.measurement_appointments where enterprise_id=${eid}) as appointment_count
      from app.assistant_conversations where enterprise_id=${eid} and id=${conversationId}`));
    assert.deepEqual(state, { offer: { fixture: 'new' }, appointment_count: 1 });

    await withTenantTransaction(eid, tx => tx.execute(sql`update app.leads set customer_user_id=null
      where enterprise_id=${eid} and id=${leadId}`));
    await assert.rejects(booking.book(key, request), { code: 'assistant_resource_not_found' });
  } finally {
    try {
      if (fixture.eid) await withTenantTransaction(fixture.eid, async tx => {
        await tx.execute(sql`delete from app.measurement_appointment_events where enterprise_id=${fixture.eid}`);
        await tx.execute(sql`delete from app.measurement_appointments where enterprise_id=${fixture.eid}`);
      });
    } finally {
      await fixture.cleanup();
    }
  }
});

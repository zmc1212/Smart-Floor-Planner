import {sql} from 'drizzle-orm';
import {withTenantTransaction} from '@/db/transaction';
import {one} from '@/db/repositories/assistant-repository';
import {fail} from '@/lib/assistant/contracts';
import type {CameraStream,WvpClient} from './wvp';
import {currentStorageHealth} from './storage';

// WVP can retain an MP4 writer when unlinking a plan with live readers.
// Recheck our durable policy before granting this viewer its media generation.
export async function guardLiveWriter(eid:string,bid:string,stream:CameraStream,upstream:WvpClient){
  await withTenantTransaction(eid,async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-recording:${bid}`},0))`);
    const p=await one(tx,sql`select p.*,c.device_id,c.channel_id from app.construction_camera_recording_policies p
      join app.construction_camera_bindings b on b.enterprise_id=p.enterprise_id and b.id=p.binding_id
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where p.enterprise_id=${eid} and p.binding_id=${bid} and b.ended_at is null`);
    if(!p?.plan_id)return;
    const health=await currentStorageHealth();
    if(p.enabled&&!health.blocked&&!['blocked','unavailable'].includes(String(p.storage_level)))return;
    const owned=await upstream.recordingPlan('SFP-'+p.source_key,false);if(owned!==Number(p.plan_id))return;
    const channel=await upstream.recordingChannel(String(p.device_id),String(p.channel_id),owned);
    if(channel.planId&&channel.planId!==owned)return; // Never control a foreign plan.
    if(await upstream.isRecording(stream))await upstream.stopRecording(stream);
    if(await upstream.isRecording(stream))fail('camera_recording_stop_unconfirmed',503);
  });
}

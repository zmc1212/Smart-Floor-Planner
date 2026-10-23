import {sql} from 'drizzle-orm';
import type {PostgresTransaction} from '@/db/transaction';
import {one} from '@/db/repositories/assistant-repository';
import {fail} from '@/lib/assistant/contracts';
import type {WvpClient} from './wvp';
export const recordingDate=(value:unknown)=>new Date(value instanceof Date?value.getTime():String(value));
export type RecordingClock={source:Date;business:Date;began:number;min:number;max:number};
export async function sampleRecordingClock(tx:PostgresTransaction,upstream:WvpClient):Promise<RecordingClock>{
  const began=performance.now(),source=await upstream.recordingClock();
  const row=await one(tx,sql`select clock_timestamp() business_now`),business=recordingDate(row!.business_now),elapsed=Math.ceil(performance.now()-began);
  // HTTP Date has one-second precision; include the whole request/DB round trip.
  const min=business.getTime()-source.getTime()-1000-elapsed,max=business.getTime()-source.getTime();
  if(!Number.isFinite(min)||Math.abs(min)>60000||Math.abs(max)>60000||elapsed>15000)fail('camera_recording_clock_unavailable',503);
  return {source,business,began,min,max};
}
export const recordingSourceNow=(clock:RecordingClock)=>new Date(clock.source.getTime()+1000+Math.ceil(performance.now()-clock.began));

import QRCode from 'qrcode';
import { z } from 'zod';
import { fail, id, type ActorContext } from '../contracts';
import { disconnectChannel, pollChannel, recipientState, startChannel } from './channels';

const version = z.number().int().positive();
const action = z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('start')}),
  z.strictObject({action:z.literal('poll'),id:z.uuid(),pin:z.string().regex(/^\d{1,12}$/).optional()}),
  z.strictObject({action:z.literal('disconnect'),id:z.uuid()}),
  z.strictObject({action:z.literal('renew'),id:z.uuid(),version}),
  z.strictObject({action:z.literal('upgrade'),id:z.uuid(),version}),
  z.strictObject({action:z.literal('preferences'),id:z.uuid(),version,daily:z.boolean(),weekly:z.boolean()}),
]);
export async function recipientHttp(request:Request,actor:ActorContext,bindingId:string) {
  const params = new URL(request.url).searchParams;
  const roleScope = params.get('scope') === 'role';
  if (params.size !== 1 || (!roleScope && !params.has('projectId'))) fail('invalid_message',422);
  const recipient = {actor,bindingId:id(bindingId),projectId:roleScope ? null : id(params.get('projectId'))};
  const scope = {enterpriseId:actor.enterpriseId,stage:'main' as const,recipient};
  let result;
  if (request.method === 'POST') {
    const raw = await request.text();
    if (raw.length > 1024) fail('invalid_message',422);
    let input;
    try { input=action.parse(JSON.parse(raw)); } catch { return fail('invalid_message',422); }
    switch(input.action) {
      case 'start': await startChannel(scope); break;
      case 'poll': await pollChannel(scope,input.id,input.pin); break;
      case 'disconnect': await disconnectChannel(scope,input.id); break;
      case 'renew': result=await recipientState(recipient,{kind:'renew'},input); break;
      case 'upgrade': result=await recipientState(recipient,{kind:'upgrade'},input); break;
      case 'preferences': result=await recipientState(recipient,{kind:'preferences',daily:input.daily,weekly:input.weekly},input); break;
    }
  } else if (request.method !== 'GET') fail('assistant_resource_not_found',404);
  result ??= await recipientState(recipient);
  if (result.channel?.qr) return {...result,channel:{...result.channel,qr:null,qrImage:
    await QRCode.toDataURL(result.channel.qr,{width:400,margin:4,errorCorrectionLevel:'M'})}};
  return result;
}

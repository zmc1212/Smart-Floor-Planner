import {sql} from 'drizzle-orm';
import {withTenantTransaction,type PostgresTransaction} from '@/db/transaction';
import type {ModelTurnOutput} from '../contracts/model';

/** Original per-turn ledger operation, also used when a workflow transport
 * fails after the provider returned. The unique operation prevents double
 * billing records when the normal Worker consumes the same observation. */
export function recordAgentModelUsage(enterpriseId:string,runId:string,turn:number,packet:{agentOutput?:ModelTurnOutput;attemptId?:string|number|bigint|null},after?:(tx:PostgresTransaction)=>Promise<boolean>) {
  return withTenantTransaction(enterpriseId,async tx=>{
    const usage=packet.agentOutput?.usage;
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
      values(${enterpriseId},${runId},${packet.attemptId?String(packet.attemptId):null},${'agent:'+runId+':'+turn},'tokens',
        ${usage?usage.inputTokens+usage.outputTokens:null},${usage?'observed':'unavailable'},${usage?.inputTokens??null},${usage?.outputTokens??null}) on conflict do nothing`);
    return after?after(tx):true;
  });
}

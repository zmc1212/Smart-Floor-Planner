import { fail } from '../contracts';
import { allRequirementKeys, type RequirementKey } from './contract';
import type { RequirementChange, RequirementItem, requirementSources } from './items';

/** Compile an explicit keep/write partition into the existing domain commands.
 * Retention is an immutable reference, never a replacement quotation. */
export function requirementPlan(items: RequirementItem[], sources: ReturnType<typeof requirementSources>,
  currentMessageId: string, value: unknown): RequirementChange[] {
  if (!value || typeof value!=='object' || Array.isArray(value)) fail('invalid_requirement_plan',422);
  const p=value as Record<string,unknown>;
  if(Object.keys(p).some(k=>!['retainedIds','changes'].includes(k)) || !Array.isArray(p.retainedIds)
    || !Array.isArray(p.changes) || p.retainedIds.length>40 || p.changes.length>20)fail('invalid_requirement_plan',422);
  const known=new Set(items.map(i=>i.id)),retained=new Set<string>(),changed=new Set<string>();
  for(const id of p.retainedIds){
    if(typeof id!=='string' || !known.has(id) || retained.has(id))fail('requirement_target_changed');
    retained.add(id);
  }
  const changes:RequirementChange[]=[];
  for(const input of p.changes){
    if(!input || typeof input!=='object' || Array.isArray(input))fail('invalid_requirement_plan',422);
    const c=input as Record<string,unknown>,op=c.operation;
    if(!['add','replace','remove'].includes(String(op)))fail('invalid_requirement_plan',422);
    const allowed=op==='add'?['operation','field','sourceId']:['operation','targetId','sourceId'];
    if(Object.keys(c).some(k=>!allowed.includes(k)))fail('invalid_requirement_plan',422);
    if(op!=='add'){
      if(typeof c.targetId!=='string' || !known.has(c.targetId) || changed.has(c.targetId))fail('requirement_target_changed');
      if(retained.has(c.targetId))fail('requirement_retention_conflict');
      changed.add(c.targetId);
    }
    const source=sources.find(s=>s.id===c.sourceId);
    if(!source || (op==='remove' && source.sourceMessageId!==currentMessageId))fail('invalid_requirement_evidence',422);
    if(op==='remove')changes.push({operation:'remove',targetId:String(c.targetId)});
    else if(op==='replace')changes.push({operation:'replace',targetId:String(c.targetId),sourceId:source.id});
    else{
      if(!allRequirementKeys.includes(c.field as RequirementKey))fail('invalid_requirement_plan',422);
      changes.push({operation:'add',field:c.field as RequirementKey,sourceId:source.id});
    }
  }
  if([...known].some(id=>!retained.has(id)&&!changed.has(id)))fail('requirement_scope_incomplete',422);
  return changes;
}

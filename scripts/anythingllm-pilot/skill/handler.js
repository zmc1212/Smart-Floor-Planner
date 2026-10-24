module.exports.runtime = {
  handler: async function ({ action, query = '', sourceSeq, fields, quote }) {
    const direct = ['create_requirement_draft', 'request_designer', 'read_business_status'].includes(action);
    const unknownReceipt = '暂时无法核实这次操作是否完成，请先重新查询当前状态。目前不能确认需求已保存或接待请求已提交。';
    // Native AnythingLLM direct output terminates its tool loop. A successful
    // write, a rejected write and a lost response must never return to the LLM
    // for a speculative success summary.
    if (direct && this.super) this.super.skipHandleExecution = true;
    const workspaceId = this.super?.handlerProps?.invocation?.workspace_id;
    if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) {
      return direct ? unknownReceipt : JSON.stringify({ ok: false, error: 'unbound_workspace' });
    }
    try {
      const response = await fetch(`${process.env.SFP_PILOT_BRIDGE}/tools`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SFP_PILOT_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action, query, sourceSeq, fields, quote }),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok) {
        if (direct) return unknownReceipt;
        const failure = await response.json().catch(() => ({}));
        const safe = ['draft_context_required', 'invalid_requirement_evidence', 'requirements_stale', 'handoff_intent_required', 'context_changed', 'handoff_active'];
        return JSON.stringify({ ok: false, status: response.status,
          error: safe.includes(failure.error) ? failure.error : 'tool_rejected_or_unavailable',
          instruction: '本次动作失败，不声称保存或联系成功；草稿出处错误可重新读取客户原话，人工接续意图不明应澄清。' });
      }
      if (direct) {
        const result = await response.json();
        const r = result.receipt;
        const kind = {create_requirement_draft:'requirement',request_designer:'handoff',read_business_status:'business_status'}[action];
        if (result.ok !== true || result.workspaceId !== workspaceId || r?.protocol !== 'sfp-business-receipt-v1'
          || r.action !== action || r.entity?.kind !== kind || typeof r.requestKey !== 'string' || !r.requestKey
          || r.outcome !== (action === 'read_business_status' ? 'read' : 'applied')
          || (action === 'request_designer' && (r.entity.status !== 'waiting' || r.entity.id !== r.requestKey))
          || (action === 'create_requirement_draft' && (r.entity.status !== 'draft' || !r.entity.id || !Number.isSafeInteger(r.entity.version)))
          || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 20000) return unknownReceipt;
        return r.text;
      }
      return await response.text();
    } catch {
      return direct ? unknownReceipt : JSON.stringify({ ok: false, error: 'tool_unavailable', instruction: '如实说明功能暂不可用，不声称已查询或保存。' });
    }
  },
};

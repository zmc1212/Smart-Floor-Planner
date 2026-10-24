module.exports.runtime = {
  handler: async function ({ action, query = '', sourceSeq, fields, quote }) {
    const workspaceId = this.super?.handlerProps?.invocation?.workspace_id;
    if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) {
      return JSON.stringify({ ok: false, error: 'unbound_workspace' });
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
        const failure = await response.json().catch(() => ({}));
        const safe = ['draft_context_required', 'invalid_requirement_evidence', 'requirements_stale', 'handoff_intent_required', 'context_changed', 'handoff_active'];
        return JSON.stringify({ ok: false, status: response.status,
          error: safe.includes(failure.error) ? failure.error : 'tool_rejected_or_unavailable',
          instruction: '本次动作失败，不声称保存或联系成功；草稿出处错误可重新读取客户原话，人工接续意图不明应澄清。' });
      }
      return await response.text();
    } catch {
      return JSON.stringify({ ok: false, error: 'tool_unavailable', instruction: '如实说明功能暂不可用，不声称已查询或保存。' });
    }
  },
};

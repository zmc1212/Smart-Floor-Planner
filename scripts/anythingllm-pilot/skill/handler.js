module.exports.runtime = {
  handler: async function ({ action, query = '', sourceSeq, fields }) {
    const workspaceId = this.super?.handlerProps?.invocation?.workspace_id;
    if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) {
      return JSON.stringify({ ok: false, error: 'unbound_workspace' });
    }
    try {
      const response = await fetch(`${process.env.SFP_PILOT_BRIDGE}/tools`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SFP_PILOT_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action, query, sourceSeq, fields }),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        const safe = ['draft_context_required', 'invalid_requirement_evidence', 'requirements_stale'];
        return JSON.stringify({ ok: false, status: response.status,
          error: safe.includes(failure.error) ? failure.error : 'tool_rejected_or_unavailable',
          instruction: '失败不等于保存成功；如是草稿上下文或出处问题，重新读取客户原话后再提交。' });
      }
      return await response.text();
    } catch {
      return JSON.stringify({ ok: false, error: 'tool_unavailable', instruction: '如实说明功能暂不可用，不声称已查询或保存。' });
    }
  },
};

module.exports.runtime = {
  handler: async function ({ action, query = '' }) {
    const workspaceId = this.super?.handlerProps?.invocation?.workspace_id;
    if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) {
      return JSON.stringify({ ok: false, error: 'unbound_workspace' });
    }
    try {
      const response = await fetch(`${process.env.SFP_PILOT_BRIDGE}/tools`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SFP_PILOT_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action, query }),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok) return JSON.stringify({ ok: false, status: response.status, error: 'tool_rejected_or_unavailable' });
      return await response.text();
    } catch {
      return JSON.stringify({ ok: false, error: 'tool_unavailable', instruction: '如实说明功能暂不可用，不声称已查询或保存。' });
    }
  },
};

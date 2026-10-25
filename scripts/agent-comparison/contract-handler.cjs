module.exports.runtime = {
  handler: async function (args) {
    const workspaceId = this.super?.handlerProps?.invocation?.workspace_id;
    try {
      const response = await fetch(`${process.env.SFP_PILOT_BRIDGE}/contract/execute`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
        headers: { Authorization: `Bearer ${process.env.SFP_PILOT_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, args }),
      });
      const result = await response.json();
      if (!response.ok || result.workspaceId !== workspaceId) throw Error('contract_bridge_unavailable');
      if (result.terminal && this.super) this.super.skipHandleExecution = true;
      return result.terminal ? result.text : JSON.stringify(result);
    } catch {
      if (this.super) this.super.skipHandleExecution = true;
      return '本次办理结果暂时无法核实，请重新查询当前状态；不能确认已保存或已提交接待，也不能自动重复办理。';
    }
  },
};

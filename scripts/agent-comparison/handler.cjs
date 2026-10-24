module.exports.runtime = {
  handler: async function (args) {
    const name = this.config?.hubId || this.__comparisonName;
    const direct = name === 'sfp-comparison-business';
    if (direct && this.super) this.super.skipHandleExecution = true;
    const workspaceId = this.super?.handlerProps?.invocation?.workspace_id;
    try {
      const response = await fetch(`${process.env.SFP_PILOT_BRIDGE}/comparison/tools`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${process.env.SFP_PILOT_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name, args }),
      });
      const value = await response.json();
      if (!response.ok || value.workspaceId !== workspaceId || typeof value.text !== 'string') throw Error('receipt_unavailable');
      return value.text;
    } catch {
      return '暂时无法核实这次操作的结果，请重新查询当前状态；不能确认已保存或已提交接待。';
    }
  },
};

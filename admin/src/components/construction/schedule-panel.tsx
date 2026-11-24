'use client';

import { ProTable } from '@ant-design/pro-components';
import { Button, Tag } from 'antd';
import type { Milestone, ScheduleProgress } from './client';

export type ScheduleEditorKind = 'template' | 'followup' | 'agreement' | 'view';
const completionDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
export const milestoneCompletionDate = (value: string) => completionDate.format(new Date(value));

export function SchedulePanel({ progress, disabled, open }: {
  progress: ScheduleProgress;
  disabled: boolean;
  open: (kind: ScheduleEditorKind, milestone?: Milestone) => void;
}) {
  const plan = progress.management;
  if (!plan) return null;
  return <ProTable<Milestone>
    rowKey="key" headerTitle="施工计划" search={false} options={false} pagination={false}
    dataSource={plan.milestones} locale={{ emptyText: '套用阶段模板后即可填写预计时间。' }}
    toolBarRender={() => [
      <Tag key="standard">标准整装</Tag>,
      <Button key="template" disabled={disabled} onClick={() => open('template')}>套用模板</Button>,
    ]}
    columns={[
      { title: '阶段节点', dataIndex: 'name' },
      { title: '计划时间', render: (_, node) => node.completedAt && !node.estimate && !node.agreedDate ? '—' : node.timeText },
      { title: '进展', render: (_, node) => {
        if (node.completedAt) return <Tag color="green">已完成 · {milestoneCompletionDate(node.completedAt)}</Tag>;
        if (node.overdueDays) return <Tag color="gold">超出预计 {node.overdueDays} 天 · 待核实</Tag>;
        return <Tag>{node.label}</Tag>;
      } },
      { title: '操作', valueType: 'option', render: (_, node) => {
        if (!node.valid) return null;
        if (node.completedAt) return <Button type="link" onClick={() => open('view', node)}>查看</Button>;
        if (node.kind === 'handover') return <Button type="link" disabled={disabled} onClick={() => open('agreement', node)}>
          {node.agreedDate ? '登记改期' : '登记约定'}
        </Button>;
        return <Button type="link" disabled={disabled} onClick={() => open('followup', node)}>
          {node.overdueDays ? '跟进' : node.estimate ? '调整预计' : '填写预计'}
        </Button>;
      } },
    ]}
  />;
}

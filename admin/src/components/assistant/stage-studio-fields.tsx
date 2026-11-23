'use client';
import { useState, type ReactNode } from 'react';
import { Button, Checkbox, Input, InputNumber, Modal, Radio, Select, Space, Switch, Tooltip } from 'antd';
import {
  Bot,
  Braces,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  Database,
  FileUp,
  Globe,
  Keyboard,
  Lightbulb,
  MessageCircle,
  Mic,
  Monitor,
  Pencil,
  Plus,
  Settings2,
  Volume2,
  Workflow,
} from 'lucide-react';
import type { EnterpriseStageAgent, StageWorkflowOption } from '@/lib/xiaok-v1/stage-workflow-settings';
import { defaultStageExperience, type StageExperience } from '@/lib/xiaok-v1/stage-experience';
import { stageDefinition } from '@/lib/xiaok-v1/stages';

export type StudioDraft = EnterpriseStageAgent & { experience: StageExperience };
export function makeDraft(agent: EnterpriseStageAgent): StudioDraft {
  return {
    ...agent,
    enabled: agent.version ? agent.enabled : true,
    experience: agent.experience ?? { ...defaultStageExperience(), followUp: agent.version ? 'inherit' : 'off' },
  };
}
export function stagePayload(agent: StudioDraft, enterpriseId: string) {
  return {
    expectedEnterpriseId: enterpriseId,
    expectedVersion: agent.version,
    stageId: agent.stageId,
    name: agent.name,
    description: agent.description,
    enabled: agent.enabled,
    experience: agent.experience,
    suggestedQuestions: agent.suggestedQuestions,
    defaultWorkflowId: agent.defaultWorkflowId,
    workflows: agent.workflows.map(({ definitionId, revision, digest }) => ({ definitionId, revision, digest })),
  };
}
export function draftIssue(draft: StudioDraft) {
  if (!draft.name.trim() || !draft.description.trim()) return '填写 Agent 名称和职责说明';
  if (draft.suggestedQuestions.some((q) => !q.title.trim() || !q.helper.trim() || !q.text.trim()))
    return '请补全预设问题的标题、副标题和完整问题';
  return '';
}
type Option =
  | 'profile'
  | 'model'
  | 'vars'
  | 'tools'
  | 'knowledge'
  | 'file'
  | 'follow'
  | 'guide'
  | 'speech'
  | 'bindings'
  | 'insert';
const titles: Record<Option, string> = {
  profile: '阶段 Agent 资料',
  model: '模型参数',
  vars: '全局变量',
  tools: '选择工具',
  knowledge: '企业知识库',
  file: '文件上传',
  follow: '猜你想问',
  guide: '输入引导',
  speech: '语音播放',
  bindings: '关联已发布工作流',
  insert: '插入变量',
};
const options = (list: [string, string][]) => list.map(([value, label]) => ({ value, label }));
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ss-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Row({
  title,
  icon,
  tip,
  action,
  onClick,
  children,
}: {
  title: string;
  icon: ReactNode;
  tip?: string;
  action?: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="ss-row">
      <div className="ss-row-heading">
        <strong>
          {icon}
          {title}
          {tip && (
            <Tooltip title={tip}>
              <CircleHelp size={13} tabIndex={0} />
            </Tooltip>
          )}
        </strong>
        {action && (
          <Button size="small" type="text" disabled={!onClick} onClick={onClick} aria-label={title + '设置'}>
            {action}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}
export function StageStudioFields({
  draft,
  change,
  templates,
  model,
  canPublish,
  initialSection,
}: {
  draft: StudioDraft;
  change: (a: StudioDraft) => void;
  templates: StageWorkflowOption[];
  model: string | null;
  canPublish: boolean;
  initialSection?: string;
}) {
  const [dialog, setDialog] = useState<Option | null>(null),
    [buffer, setBuffer] = useState(draft),
    [words, setWords] = useState(''),
    [error, setError] = useState('');
  const [fold, setFold] = useState(false),
    [question, setQuestion] = useState<number | null>(null);
  const [section, setSection] = useState(initialSection || 'ai');
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  const c = draft.experience,
    b = buffer.experience;
  const set = (v: Partial<StageExperience>) => change({ ...draft, experience: { ...c, ...v } });
  const temp = (v: Partial<StageExperience>) => setBuffer({ ...buffer, experience: { ...b, ...v } });
  const open = (v: Option) => {
    setBuffer(structuredClone(draft));
    setWords(c.lexicon.join('\n'));
    setError('');
    setDialog(v);
  };
  const jump = (key: string) => {
    setSection(key);
    const pane = document.querySelector('.ss-settings'),
      target = document.getElementById('ss-' + key);
    if (pane && target)
      pane.scrollTo({
        top: pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 48,
      });
  };
  const apply = () => {
    if (dialog === 'guide') {
      const lexicon = [
        ...new Set(
          words
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      if ((b.guideEnabled && !lexicon.length) || lexicon.length > 80 || lexicon.some((s) => s.length > 200)) {
        setError('可录入 1–80 条问法，每条最多 200 字。');
        return;
      }
      change({ ...buffer, experience: { ...b, lexicon } });
    } else if (dialog === 'profile' && (!buffer.name.trim() || !buffer.description.trim())) {
      setError('请填写名称和职责说明');
      return;
    } else if (
      dialog === 'vars' &&
      (b.variables.some((v) => !v.name.trim() || /[{}]/u.test(v.name) || v.name.trim() === '施工阶段') ||
        new Set(b.variables.map((v) => v.name.trim())).size !== b.variables.length)
    ) {
      setError('每个变量都需要唯一名称，施工阶段是系统变量。');
      return;
    } else change(buffer);
    setDialog(null);
  };
  const patchQ = (i: number, key: 'title' | 'helper' | 'text', value: string) =>
    change({
      ...draft,
      suggestedQuestions: draft.suggestedQuestions.map((q, n) => (n === i ? { ...q, [key]: value } : q)),
    });
  const toggle = (label: string, val: boolean, cb: (v: boolean) => void) => (
    <div className="ss-toggle">
      {label}
      <Switch aria-label={label} checked={val} onChange={cb} />
    </div>
  );
  const bindings = (selected: StageWorkflowOption[]) =>
    setBuffer({
      ...buffer,
      workflows: selected,
      defaultWorkflowId: selected.some((t) => t.definitionId === buffer.defaultWorkflowId)
        ? buffer.defaultWorkflowId
        : (selected[0]?.definitionId ?? null),
    });
  const stage = stageDefinition(draft.stageId)!.name;
  return (
    <aside className="ss-settings" aria-label="应用配置">
      <section className="ss-card ss-profile">
        <div>
          <span className="ss-app-icon">
            <Bot />
          </span>
          <div>
            <small>阶段应用 / {stage}</small>
            <h1>{draft.name}</h1>
          </div>
          <Button icon={<Settings2 size={17} />} aria-label="编辑 Agent 资料" onClick={() => open('profile')} />
        </div>
        <p>{draft.description}</p>
      </section>
      <nav className="ss-jumps">
        {[
          ['ai', 'AI 配置'],
          ['resources', '工具与知识'],
          ['experience', '对话体验'],
          ['flows', '工作流'],
        ].map(([key, label]) => (
          <button key={key} aria-current={section === key ? 'location' : undefined} onClick={() => jump(key)}>
            {label}
          </button>
        ))}
      </nav>
      <section className="ss-card ss-ai" id="ss-ai">
        <h3>
          <Bot />
          AI 配置
        </h3>
        <div className="ss-model">
          <span>AI 模型</span>
          <Button block onClick={() => open('model')}>
            {model || '查看企业模型配置'} <ChevronDown size={14} />
          </Button>
          <Button type="text" icon={<Settings2 size={16} />} aria-label="模型参数" onClick={() => open('model')} />
        </div>
        <div className="ss-row-heading">
          <label htmlFor="ss-prompt">提示词</label>
          <Button
            size="small"
            type="link"
            onClick={() => {
              const t = document.getElementById('ss-prompt') as HTMLTextAreaElement;
              setCaret({ start: t.selectionStart, end: t.selectionEnd });
              open('insert');
            }}
          >
            插入变量
          </Button>
        </div>
        <Input.TextArea
          id="ss-prompt"
          rows={4}
          maxLength={3200}
          placeholder="填写阶段职责与回答要求，输入 / 可插入变量"
          value={c.prompt}
          onChange={(ev) => {
            const t = ev.target;
            set({ prompt: t.value });
            if ((ev.nativeEvent as InputEvent).data === '/') {
              setCaret({ start: t.selectionStart - 1, end: t.selectionEnd });
              open('insert');
            }
          }}
        />
      </section>
      <section className="ss-card" id="ss-resources">
        <Row title="虚拟机" icon={<Monitor />} action="未接入" />
        <Row title="工具" icon={<BriefcaseBusiness />} action="＋ 选择" onClick={() => open('tools')}>
          {(c.readWeb || c.searchWeb) && (
            <div className="ss-tags">
              {c.readWeb && (
                <span>
                  <Globe />
                  网页内容抓取
                </span>
              )}
              {c.searchWeb && (
                <span>
                  <Globe />
                  联网检索
                </span>
              )}
            </div>
          )}
        </Row>
        <Row
          title="知识库"
          icon={<Database />}
          action="参数与选择"
          onClick={() => open('knowledge')}
          tip="按使用者授权和资料发布状态检索"
        >
          {c.knowledge && (
            <div className="ss-tags">
              <span>
                <Database />
                当前企业获权资料
              </span>
            </div>
          )}
        </Row>
        <Row
          title="文件上传"
          icon={<FileUp />}
          action={c.attachments ? '开启' : '关闭'}
          onClick={() => open('file')}
        />
        <Row
          title="全局变量"
          icon={<Braces />}
          action={c.variables.length ? c.variables.length + ' 个 · 管理' : '＋ 新增'}
          onClick={() => open('vars')}
        />
      </section>
      <section className="ss-card" id="ss-experience">
        <Row
          title="对话开场白"
          icon={<MessageCircle />}
          action={fold ? '展开' : '收起'}
          onClick={() => setFold(!fold)}
          tip="新会话欢迎语，下方问题点选后直接发送。"
        >
          {!fold && (
            <>
              <Input.TextArea
                aria-label="对话开场白内容"
                rows={3}
                maxLength={1600}
                value={c.welcome}
                placeholder="留空沿用工地开场白，支持 {{施工阶段}}"
                onChange={(ev) => set({ welcome: ev.target.value })}
              />
              {draft.suggestedQuestions.map((q, i) => (
                <div className="ss-question" key={i}>
                  <div className="ss-row-heading">
                    <button onClick={() => setQuestion(question === i ? null : i)}>
                      <Pencil size={13} />
                      {q.title || '预设问题 ' + (i + 1)}
                    </button>
                    <Space>
                      {i > 0 && (
                        <Button
                          size="small"
                          type="link"
                          onClick={() => {
                            const qs = [...draft.suggestedQuestions];
                            [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
                            change({ ...draft, suggestedQuestions: qs });
                            setQuestion(i - 1);
                          }}
                        >
                          上移
                        </Button>
                      )}
                      <Button
                        size="small"
                        type="text"
                        onClick={() => {
                          change({
                            ...draft,
                            suggestedQuestions: draft.suggestedQuestions.filter((_, n) => n !== i),
                          });
                          setQuestion(null);
                        }}
                      >
                        移除
                      </Button>
                    </Space>
                  </div>
                  {question === i && (
                    <>
                      <Field label="卡片标题">
                        <Input
                          maxLength={8}
                          value={q.title}
                          onChange={(ev) => patchQ(i, 'title', ev.target.value)}
                        />
                      </Field>
                      <Field label="副标题">
                        <Input
                          maxLength={10}
                          value={q.helper}
                          onChange={(ev) => patchQ(i, 'helper', ev.target.value)}
                        />
                      </Field>
                      <Field label="点击后发送的完整问题">
                        <Input
                          maxLength={200}
                          value={q.text}
                          onChange={(ev) => patchQ(i, 'text', ev.target.value)}
                        />
                      </Field>
                    </>
                  )}
                </div>
              ))}
              <Button
                type="link"
                size="small"
                icon={<Plus size={13} />}
                disabled={draft.suggestedQuestions.length >= 3}
                onClick={() => {
                  setQuestion(draft.suggestedQuestions.length);
                  change({
                    ...draft,
                    suggestedQuestions: [...draft.suggestedQuestions, { title: '', helper: '', text: '' }],
                  });
                }}
              >
                新增预设问题
              </Button>
            </>
          )}
        </Row>
        <Row
          title="语音播放"
          icon={<Volume2 />}
          action={c.readAloud ? '浏览器自带' : '关闭'}
          onClick={() => open('speech')}
        />
        <Row title="语音输入" icon={<Mic />} action="由小程序设备配置" />
        <Row
          title="猜你想问"
          icon={<Lightbulb />}
          action={{ on: '开启', off: '关闭', inherit: '沿用企业配置' }[c.followUp]}
          onClick={() => open('follow')}
          tip="回答完成后生成相关追问。"
        />
        <Row
          title="输入引导"
          icon={<Keyboard />}
          action={c.guideEnabled ? '开启 · ' + c.lexicon.length + ' 条' : '关闭'}
          onClick={() => open('guide')}
          tip="打字时匹配阶段词库。"
        />
      </section>
      <section className="ss-card" id="ss-flows">
        <Row title="可调用的工作流" icon={<Workflow />} action="关联工作流" onClick={() => open('bindings')}>
          {draft.workflows.length ? (
            draft.workflows.map((ref) => (
              <div className="ss-binding" key={ref.definitionId}>
                <strong>
                  {ref.name} <small>v{ref.revision}</small>
                </strong>
                <p>{ref.description}</p>
                <Space>
                  {draft.defaultWorkflowId === ref.definitionId ? (
                    <small>默认工作流</small>
                  ) : (
                    <Button size="small" onClick={() => change({ ...draft, defaultWorkflowId: ref.definitionId })}>
                      设为默认
                    </Button>
                  )}
                  {canPublish && (
                    <a target="_blank" rel="noreferrer" href={'/native-workflow/' + ref.definitionId}>
                      打开画布 ↗
                    </a>
                  )}
                </Space>
              </div>
            ))
          ) : (
            <p className="ss-muted">尚未关联工作流</p>
          )}
        </Row>
      </section>
      <Modal
        title={dialog ? titles[dialog] : ''}
        open={!!dialog}
        onCancel={() => setDialog(null)}
        onOk={apply}
        okText="确认"
        cancelText="取消"
        footer={dialog === 'insert' ? null : undefined}
        destroyOnHidden
      >
        {dialog === 'profile' && (
          <>
            <Field label="Agent 名称">
              <Input
                maxLength={60}
                value={buffer.name}
                onChange={(ev) => setBuffer({ ...buffer, name: ev.target.value })}
              />
            </Field>
            <Field label="职责说明">
              <Input.TextArea
                maxLength={240}
                value={buffer.description}
                onChange={(ev) => setBuffer({ ...buffer, description: ev.target.value })}
              />
            </Field>
            {toggle('启用阶段 Agent', buffer.enabled, (v) => setBuffer({ ...buffer, enabled: v }))}
          </>
        )}
        {dialog === 'model' && (
          <>
            <Field label="当前已授权模型">
              <Input value={model || '企业尚未配置'} readOnly />
            </Field>
            <Field label="记忆轮数">
              <InputNumber
                min={1}
                max={20}
                value={b.historyRounds}
                onChange={(v) => v && temp({ historyRounds: v })}
              />
            </Field>
            <Field label="回复上限（tokens）">
              <InputNumber
                min={128}
                max={2048}
                value={b.maxTokens}
                onChange={(v) => v && temp({ maxTokens: v })}
              />
            </Field>
            <Field label="温度">
              <InputNumber
                min={0}
                max={2}
                step={0.1}
                value={b.temperature}
                onChange={(v) => v !== null && temp({ temperature: v })}
              />
            </Field>
          </>
        )}
        {dialog === 'tools' && (
          <>
            {toggle('网页内容抓取', b.readWeb, (v) => temp({ readWeb: v }))}
            {toggle('联网检索', b.searchWeb, (v) => temp({ searchWeb: v }))}
          </>
        )}
        {dialog === 'knowledge' && (
          <>
            {toggle('允许检索获权企业知识', b.knowledge, (v) => temp({ knowledge: v }))}
            <Field label="检索方式">
              <Select
                value={b.searchMode}
                options={options([
                  ['hybrid', '混合检索'],
                  ['keyword', '全文检索'],
                  ['vector', '语义检索'],
                ])}
                onChange={(v) => temp({ searchMode: v })}
              />
            </Field>
            <p className="ss-muted">使用者鉴权始终开启，可用资料由当前企业知识权限决定。</p>
          </>
        )}
        {dialog === 'file' && toggle('允许业主上传图片资料', b.attachments, (v) => temp({ attachments: v }))}
        {dialog === 'speech' && toggle('在调试预览中朗读新回复', b.readAloud, (v) => temp({ readAloud: v }))}
        {dialog === 'vars' && (
          <>
            <p>系统变量　施工阶段 · {stage}</p>
            {b.variables.map((v, i) => (
              <div className="ss-variable" key={i}>
                <Input
                  aria-label="变量名"
                  maxLength={30}
                  value={v.name}
                  placeholder="变量名"
                  onChange={(ev) =>
                    temp({ variables: b.variables.map((p, n) => (n === i ? { ...p, name: ev.target.value } : p)) })
                  }
                />
                <Input
                  aria-label="变量值"
                  maxLength={160}
                  value={v.value}
                  placeholder="值"
                  onChange={(ev) =>
                    temp({
                      variables: b.variables.map((p, n) => (n === i ? { ...p, value: ev.target.value } : p)),
                    })
                  }
                />
                <Button onClick={() => temp({ variables: b.variables.filter((_, n) => n !== i) })}>移除</Button>
              </div>
            ))}
            <Button
              disabled={b.variables.length >= 20}
              onClick={() => temp({ variables: [...b.variables, { name: '', value: '' }] })}
            >
              新增变量
            </Button>
          </>
        )}
        {dialog === 'insert' && (
          <Space wrap>
            {['施工阶段', ...c.variables.map((v) => v.name)].map((s) => (
              <Button
                key={s}
                onClick={() => {
                  set({ prompt: c.prompt.slice(0, caret.start) + '{{' + s + '}}' + c.prompt.slice(caret.end) });
                  setDialog(null);
                }}
              >
                {s}
              </Button>
            ))}
          </Space>
        )}
        {dialog === 'follow' && (
          <>
            <Field label="回答后的追问">
              <Radio.Group
                value={b.followUp}
                onChange={(ev) => temp({ followUp: ev.target.value })}
                options={options([
                  ['on', '开启'],
                  ['off', '关闭'],
                  ['inherit', '沿用企业'],
                ])}
              />
            </Field>
            {b.followUp !== 'off' && (
              <>
                <Field label="生成模型">
                  <Input value={model || '沿用企业授权模型'} readOnly />
                </Field>
                <Field label="追问提示词">
                  <Input.TextArea
                    rows={4}
                    maxLength={1200}
                    value={b.followUpPrompt}
                    onChange={(ev) => temp({ followUpPrompt: ev.target.value })}
                  />
                </Field>
              </>
            )}
          </>
        )}
        {dialog === 'guide' && (
          <>
            {toggle('启用输入引导', b.guideEnabled, (v) => temp({ guideEnabled: v }))}
            {b.guideEnabled && (
              <Field label="预设问法，每行一条">
                <Input.TextArea
                  rows={7}
                  maxLength={16100}
                  value={words}
                  onChange={(ev) => setWords(ev.target.value)}
                />
              </Field>
            )}
          </>
        )}
        {dialog === 'bindings' && (
          <>
            {!templates.length && <p>暂无已发布的阶段模板</p>}
            {[...new Set([...templates, ...buffer.workflows].map((t) => t.definitionId))].map((id) => {
              const choices = templates.filter((t) => t.definitionId === id),
                current = buffer.workflows.find((t) => t.definitionId === id),
                latest = choices[0] ?? current!;
              return (
                <div key={id} className="ss-binding">
                  <Checkbox
                    checked={!!current}
                    onChange={(ev) =>
                      bindings(
                        ev.target.checked
                          ? [...buffer.workflows, latest]
                          : buffer.workflows.filter((t) => t.definitionId !== id),
                      )
                    }
                  >
                    {latest.name}
                  </Checkbox>
                  <p>{latest.description}</p>
                  {current && (
                    <Select
                      aria-label={latest.name + '版本'}
                      value={current.revision}
                      options={choices.map((t) => ({ value: t.revision, label: 'v' + t.revision }))}
                      onChange={(revision) =>
                        bindings(
                          buffer.workflows.map((t) =>
                            t.definitionId === id ? choices.find((v) => v.revision === revision)! : t,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
          </>
        )}
        {error && (
          <p role="alert" className="ss-error">
            {error}
          </p>
        )}
      </Modal>
    </aside>
  );
}

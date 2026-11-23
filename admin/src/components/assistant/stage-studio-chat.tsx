'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin } from 'antd';
import { ArrowUp, ArrowUpRight, Bot, Keyboard, Lightbulb, MessageSquarePlus, Paperclip, Send } from 'lucide-react';
import {
  AssistantMutations,
  AssistantRequestError,
  assistantError,
  assistantRequest,
  formatTime,
  runIsActive,
} from './client';
import type { PageResult, PreviewConversation, PreviewMessage } from './contracts';
import { stageText } from '@/lib/xiaok-v1/stage-experience';
import { stageDefinition } from '@/lib/xiaok-v1/stages';
import { draftIssue, stagePayload, type StudioDraft } from './stage-studio-fields';

function history(id: string, signal?: AbortSignal) {
  return assistantRequest<PageResult<PreviewMessage>>('preview/conversations/' + id + '/messages?limit=50', {
    signal,
  });
}
function transcript(messages: PreviewMessage[]) {
  return messages.map((m) => (
    <div className={'ss-message ' + (m.authorKind === 'admin' ? 'ss-user' : 'ss-bot')} key={m.id}>
      {m.authorKind === 'assistant' && <Bot size={19} />}
      <div>
        {m.available === false
          ? '当前消息已不可读'
          : m.content.blocks
              .map((b) => b.text || b.fallbackText)
              .filter(Boolean)
              .join('\n')}
      </div>
    </div>
  ));
}
function matchWords(value: string, cursor: number, words: string[]) {
  const prefix = value.slice(0, cursor).split('\n').at(-1) || '';
  for (let size = Math.min(prefix.length, 20); size > 0; size--) {
    const part = prefix.slice(-size).toLowerCase();
    const items = words.filter((s) => s.toLowerCase().includes(part) && s !== prefix).slice(0, 5);
    if (items.length) return { items, start: cursor - size, end: cursor };
  }
  return null;
}
export function StageStudioChat({
  draft,
  enterpriseId,
  logs,
  active = true,
}: {
  draft: StudioDraft;
  enterpriseId: string;
  logs: boolean;
  active?: boolean;
}) {
  const c = draft.experience,
    stage = stageDefinition(draft.stageId)!.name;
  const [cid, setCid] = useState(''),
    [snapshot, setSnapshot] = useState(''),
    [text, setText] = useState(''),
    [cursor, setCursor] = useState(0);
  const [messages, setMessages] = useState<PreviewMessage[]>([]),
    [questions, setQuestions] = useState<string[]>([]),
    [error, setError] = useState('');
  const [failedRun, setFailedRun] = useState('');
  const [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false),
    [generation, refresh] = useState(0),
    [suppressed, suppress] = useState(true),
    [index, setIndex] = useState(0);
  const [sessions, setSessions] = useState<PreviewConversation[]>([]),
    [selected, setSelected] = useState<PreviewMessage[] | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null),
    upload = useRef<HTMLInputElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const mutations = useRef(new AssistantMutations()),
    sending = useRef(false),
    spoken = useRef(''),
    pending = useRef<{ key: string; text: string; payload: string; id?: string } | null>(null);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
      window.speechSynthesis?.cancel();
    },
    [],
  );
  const configJSON = JSON.stringify(stagePayload(draft, enterpriseId));
  const candidates = !suppressed && c.guideEnabled ? matchWords(text, cursor, c.lexicon) : null;
  const starter = ['今天工地做了什么？', stage + '阶段要注意什么？', '下一步什么时候？'].map(
    (q, i) => draft.suggestedQuestions[i]?.text || q,
  );
  useEffect(() => {
    if (!cid || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const [detail, list] = await Promise.all([
          assistantRequest<PreviewConversation>('preview/conversations/' + cid, { signal: controller.signal }),
          history(cid, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const rows = list.items.slice().reverse(),
          ongoing = runIsActive(detail.latestRun);
        setMessages(rows);
        setRunning(ongoing);
        if (ongoing) {
          timer = setTimeout(read, 1200);
          return;
        }
        const run = detail.latestRun;
        setFailedRun(run?.retryable ? run.id : '');
        if (run && ['failed', 'indeterminate', 'cancelled'].includes(run.status)) {
          setError(assistantError(new AssistantRequestError(run.errorCode || 'generation_failed', 409, false)));
          setQuestions([]);
          return;
        }
        const last = rows.at(-1);
        if (last?.authorKind === 'assistant') {
          const next = await assistantRequest<{ messageId: string | null; questions: string[] }>(
            'preview/conversations/' + cid + '/suggestions',
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setQuestions(next.messageId === last.id ? next.questions : []);
          if (c.readAloud && spoken.current !== last.id && 'speechSynthesis' in window) {
            spoken.current = last.id;
            const utterance = new SpeechSynthesisUtterance(last.content.blocks.map((b) => b.text || '').join(''));
            utterance.lang = 'zh-CN';
            window.speechSynthesis.speak(utterance);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(assistantError(err));
          setRunning(false);
        }
      }
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [cid, generation, c.readAloud, active]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (!logs || !active) return;
    const ac = new AbortController();
    setError('');
    void assistantRequest<PageResult<PreviewConversation>>(
      'preview/conversations?stage=' + draft.stageId + '&limit=100',
      { signal: ac.signal },
    )
      .then((v) => {
        if (!ac.signal.aborted) setSessions(v.items);
      })
      .catch((err) => {
        if (!ac.signal.aborted) setError(assistantError(err));
      });
    return () => ac.abort();
  }, [logs, active, draft.stageId, generation]);
  useEffect(() => {
    if (!c.attachments) setFile(null);
  }, [c.attachments]);
  async function send(value: string, retry = false) {
    const body =
      retry && pending.current
        ? pending.current.text
        : [value.trim(), ...(file && c.attachments ? ['附件 ' + file.name + '\n' + file.text] : [])]
            .filter(Boolean)
            .join('\n\n');
    if (!body || sending.current || running) return;
    if (body.length > 4000) {
      setError('消息和附件合计最多 4000 字，请缩短后发送。');
      return;
    }
    const problem = draftIssue(draft);
    if (problem) {
      setError(problem);
      return;
    }
    if (pending.current && (pending.current.text !== body || pending.current.payload !== configJSON)) {
      setError('上一条发送结果待核对，请先重试原消息或开启新对话。');
      return;
    }
    const item = pending.current ?? {
      key: crypto.randomUUID(),
      text: body,
      payload: configJSON,
      id: cid && snapshot === configJSON ? cid : undefined,
    };
    const currentEpoch = epoch.current;
    pending.current = item;
    sending.current = true;
    setBusy(true);
    setError('');
    suppress(true);
    try {
      if (!item.id) {
        const created = await mutations.current.write<PreviewConversation>('preview/conversations', {
          audience: 'customer_public',
          draftVersionIds: [],
          stageDraft: JSON.parse(configJSON),
        });
        item.id = created.id;
      }
      await mutations.current.write(
        'preview/conversations/' + item.id + '/messages',
        { clientMessageId: item.key, content: { version: 1, blocks: [{ type: 'text', text: body }] } },
        'POST',
        item.key,
      );
      if (currentEpoch !== epoch.current) return;
      pending.current = null;
      setCid(item.id);
      setSnapshot(configJSON);
      setRunning(true);
      setQuestions([]);
      setFile(null);
      setText('');
      refresh((n) => n + 1);
    } catch (err) {
      if (currentEpoch === epoch.current) {
        if (err instanceof AssistantRequestError && !err.uncertain) pending.current = null;
        setError(assistantError(err));
      }
    } finally {
      if (currentEpoch === epoch.current) {
        sending.current = false;
        setBusy(false);
      }
    }
  }
  async function retry() {
    if (pending.current) return send(text, true);
    if (!failedRun) {
      refresh((n) => n + 1);
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await mutations.current.write('preview/runs/' + failedRun + '/retry', {});
      setError('');
      setFailedRun('');
      setRunning(true);
      refresh((n) => n + 1);
    } catch (err) {
      setError(assistantError(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function newChat() {
    if (busy) return;
    setFailedRun('');
    pending.current = null;
    setCid('');
    setSnapshot('');
    setMessages([]);
    setQuestions([]);
    setRunning(false);
    setText('');
    setFile(null);
    setError('');
    suppress(true);
    window.speechSynthesis?.cancel();
  }
  function fill(i: number) {
    if (!candidates) return;
    const word = candidates.items[i];
    if (!word) return;
    const pos = candidates.start + word.length;
    setText(text.slice(0, candidates.start) + word + text.slice(candidates.end));
    setCursor(pos);
    suppress(true);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(pos, pos);
    });
  }
  async function inspect(id: string) {
    const rev = epoch.current;
    try {
      const list = await history(id);
      if (rev === epoch.current) setSelected(list.items.reverse());
    } catch (err) {
      if (rev === epoch.current) setError(assistantError(err));
    }
  }
  if (logs)
    return (
      <section className="ss-other">
        <h2>对话日志</h2>
        <p>{stage}阶段 · 我的调试会话</p>
        {error && <Alert type="error" message={error} />}
        {sessions.length ? (
          sessions.map((s) => (
            <button className="ss-log" key={s.id} onClick={() => void inspect(s.id)}>
              <strong>{s.title || '新调试会话'}</strong>
              <small>{formatTime(s.createdAt)}</small>
            </button>
          ))
        ) : (
          <p>暂无本阶段的调试会话。</p>
        )}
        <Modal title="调试记录" open={selected !== null} footer={null} onCancel={() => setSelected(null)}>
          {selected && transcript(selected)}
        </Modal>
      </section>
    );
  return (
    <section className="ss-chat" aria-label="调试预览">
      <header>
        <h2>调试预览</h2>
        <Button
          aria-label="新对话"
          title="新对话"
          icon={<MessageSquarePlus size={17} />}
          disabled={busy}
          onClick={newChat}
        />
      </header>
      <div ref={scroll} className="ss-transcript" role="log">
        {!messages.length && !running ? (
          <div className="ss-welcome">
            <Bot size={31} />
            <h2>{draft.name}</h2>
            <p>
              {stageText(c.welcome, stage, c.variables) ||
                '你好，我是小K。工地目前在' + stage + '阶段，想了解哪方面？'}
            </p>
            <div>
              {starter.map((q, i) => (
                <Button key={i} onClick={() => void send(q)} disabled={busy}>
                  {q} ↗
                </Button>
              ))}
            </div>
          </div>
        ) : (
          transcript(messages)
        )}
        {running && (
          <p className="ss-muted">
            <Spin size="small" /> 正在生成回复…
          </p>
        )}
        {!!questions.length && c.followUp !== 'off' && !running && (
          <section className="ss-follow">
            <strong>
              <Lightbulb size={15} />
              猜你想问
            </strong>
            {questions.map((q) => (
              <Button key={q} onClick={() => void send(q)}>
                {q} <ArrowUpRight size={14} />
              </Button>
            ))}
          </section>
        )}
      </div>
      <div className="ss-dock">
        {error && (
          <Alert
            type="error"
            message={error}
            action={
              <Button size="small" onClick={() => void retry()}>
                {failedRun ? '重新生成' : '重试'}
              </Button>
            }
          />
        )}
        {snapshot && snapshot !== configJSON && <small>配置已更改，下一次发送将开启新的调试会话。</small>}
        <div className="ss-composer">
          {candidates && (
            <div className="ss-candidates" role="listbox" aria-label="输入引导">
              <strong>
                <Keyboard size={15} />
                输入引导
              </strong>
              {candidates.items.map((s, i) => (
                <div key={s}>
                  <button role="option" aria-selected={index === i} onClick={() => fill(i)}>
                    {s}
                  </button>
                  <Button
                    type="text"
                    aria-label={'直接发送' + s}
                    icon={<Send size={14} />}
                    onClick={() => void send(s)}
                  />
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textarea}
            aria-label="调试消息"
            placeholder={'发消息给' + draft.name}
            value={text}
            disabled={busy}
            maxLength={4000}
            onChange={(ev) => {
              setText(ev.target.value);
              setCursor(ev.target.selectionStart);
              setIndex(0);
              suppress(false);
            }}
            onSelect={(ev) => setCursor(ev.currentTarget.selectionStart)}
            onKeyDown={(ev) => {
              if (ev.nativeEvent.isComposing || ev.keyCode === 229) return;
              if (
                candidates &&
                ['ArrowDown', 'ArrowUp', 'Escape', 'Tab', 'Enter'].includes(ev.key) &&
                !ev.shiftKey
              ) {
                ev.preventDefault();
                if (ev.key === 'Escape') suppress(true);
                else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')
                  setIndex(
                    (index + (ev.key === 'ArrowDown' ? 1 : -1) + candidates.items.length) %
                      candidates.items.length,
                  );
                else fill(index);
              } else if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                void send(text);
              }
            }}
          />
          <div className="ss-actions">
            {file && (
              <Button type="text" onClick={() => setFile(null)}>
                {file.name} ×
              </Button>
            )}
            {c.attachments && (
              <>
                <input
                  ref={upload}
                  type="file"
                  accept=".txt,.md,text/plain"
                  hidden
                  onChange={async (ev) => {
                    const f = ev.target.files?.[0];
                    ev.target.value = '';
                    if (!f) return;
                    if (f.size > 16000) {
                      setError('文本附件最多 4000 字');
                      return;
                    }
                    const content = await f.text();
                    if (content.length > 4000) {
                      setError('文本附件最多 4000 字');
                      return;
                    }
                    setFile({ name: f.name, text: content });
                  }}
                />
                <Button
                  type="text"
                  title="添加文本附件"
                  aria-label="添加文本附件"
                  icon={<Paperclip size={16} />}
                  onClick={() => upload.current?.click()}
                />
              </>
            )}
            <Button
              type="primary"
              aria-label="发送消息"
              loading={busy}
              disabled={running || (!text.trim() && !file)}
              icon={<ArrowUp size={16} />}
              onClick={() => void send(text)}
            />
          </div>
        </div>
        <small>调试会话仅本人可见 · 内容由 AI 生成</small>
      </div>
    </section>
  );
}

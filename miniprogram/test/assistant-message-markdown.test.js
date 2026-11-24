const assert = require('node:assert/strict');
const test = require('node:test');
const { markdownForBlock, revealMarkdown, copyableReplyText } = require('../packages/assistant/lib/message-markdown');
const { messagesForView } = require('../utils/assistant-client');

test('copy follows the visible reply, preserving numbering and omitting citation and link destinations', () => {
  const reply = { authorKind: 'assistant', available: true, replyActions: {},
    content: { version: 1, blocks: [
      { type: 'text', text: '先核对：\n\n3. **门口**\n4. [砖样](https://example.test/private)' },
      { type: 'citation', citationId: '3', fallbackText: '引用详情' },
      { type: 'text', text: '师傅到场后再复核。' },
    ] } };
  assert.equal(copyableReplyText(reply), '先核对：\n\n3. 门口\n4. 砖样\n\n师傅到场后再复核。');
  assert.equal(copyableReplyText({ ...reply, available: false }), '');
  assert.equal(copyableReplyText({ ...reply, replyActions: undefined }), '');
});

function plainFallback(text) {
  const [message] = messagesForView([{
    id: '1', seq: '1', authorKind: 'assistant', available: true,
    content: { version: 1, blocks: [{ type: 'text', text }] },
  }], markdownForBlock);
  assert.deepEqual(message.blocks, [{ key: 0, text }]);
}

test('contiguous text stays together and consecutive tables scroll independently', () => {
  const table = '| 检查 | 记录 |\n| --- | --- |\n| 书房 | **未确认** |';
  const code = ['```text', 'SW-01', '  左侧', '', '    门边', '```'].join('\n');
  const text = [
    ...Array.from({ length: 6 }, (_, i) => '#'.repeat(i + 1) + ' 标题 ' + (i + 1)),
    '> **复核**\n>\n> 3. 先看书房\n>    - 再看门边\n>      1. 看底盒',
    code, table, table, '随后继续核对。',
  ].join('\n\n');
  const parts = markdownForBlock({ text });
  assert.deepEqual(parts.map(({ key, kind }) => [key, kind]),
    [[0, 'text'], [1, 'code'], [2, 'table'], [3, 'table'], [4, 'text']]);
  assert.deepEqual(parts[0].nodes.map(node => node.name), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
  const [paragraph, list] = parts[0].nodes[6].children;
  assert.equal(paragraph.children[0].name, 'strong');
  assert.equal(list.attrs.start, 3);
  const [nested] = list.children[0].children.filter(node => node.name === 'ul');
  assert.equal(nested.children[0].children[1].name, 'ol');
  assert.equal(parts[1].nodes[0].children[0].children[0].text, 'SW-01\n  左侧\n\n    门边');
  assert.equal(parts[2].nodes[0].children[0].name, 'table');
  assert.deepEqual(parts[2].nodes, parts[3].nodes);
});

test('only sibling subitems get dashes, and typing waits for visible item text before showing its dash', () => {
  const block = { type: 'text', text: '- 核对\n  - 门口\n  - 收边' };
  const parent = parts => parts[0].nodes[0].children[0].children;
  const [first, second] = parent(markdownForBlock(block))[1].children;
  assert.equal(first.attrs.style, 'display: block; list-style-type: none; position: relative');
  for (const item of [first, second]) assert.equal(item.children[0].children[0].text, '–');
  assert.deepEqual(parent(revealMarkdown(block, 2)), [{ type: 'text', text: '核对' }]);
  const [firstRevealed] = parent(revealMarkdown(block, 3))[1].children;
  assert.equal(firstRevealed.children[0].children[0].text, '–');
  assert.equal(firstRevealed.children[1].text, '门');
  const single = parent(markdownForBlock({ text: '- 核对\n  - 门口' }))[1];
  assert.equal(single.attrs.style, 'padding-left: 0');
  assert.deepEqual(single.children[0].children, [{ type: 'text', text: '门口' }]);
  assert.doesNotMatch(copyableReplyText({ authorKind: 'assistant', available: true, replyActions: {},
    content: { blocks: [block] } }), /–/);
});

test('HTML, dangerous destinations, external media and nested links stay inert', () => {
  const text = [
    '**正文** <script>仅文字</script> <button onclick="noop">按钮文字</button>',
    '<img src="https://example.invalid/literal.png" onerror="noop">',
    '[外部说明](https://example.invalid/help) ![照片说明](https://example.invalid/image.png)',
    '![数据图片](data:image/png;base64,AA==) [JS](javascript:noop) [文件](file:///test.png) [数据](data:text/html,test)',
    '[外层 [内层](https://example.invalid/nested)](https://example.invalid/outer)',
    '**未闭合 [无目标]( 保留结尾',
  ].join('\n\n');
  const content = [];
  function inspect(nodes) {
    for (const node of nodes) {
      if (node.type === 'text') {
        assert.deepEqual(Object.keys(node).sort(), ['text', 'type']);
        content.push(node.text);
      } else {
        assert.deepEqual(Object.keys(node).sort(), ['attrs', 'children', 'name']);
        assert.match(node.name, /^(p|strong)$/);
        assert.deepEqual(node.attrs, { class: 'md-' + node.name });
        inspect(node.children);
      }
    }
  }
  for (const part of markdownForBlock({ text })) inspect(part.nodes);
  const visible = content.join(' ');
  for (const label of ['<script>仅文字</script>', '按钮文字', 'onerror="noop"', '外部说明',
    '照片说明', '数据图片', 'JS', '文件', '数据', '外层', '内层', '保留结尾']) {
    assert.ok(visible.includes(label), label);
  }
  assert.doesNotMatch(visible, /example\.invalid\/(help|image\.png|nested)|base64,AA==/);
});

test('limits fall back to the complete original, including the final line', () => {
  const prefix = '**标题**\n\n', tail = '字符边界的末尾';
  const atCharacterLimit = prefix + '字'.repeat(16000 - prefix.length - tail.length) + tail;
  assert.equal(atCharacterLimit.length, 16000);
  assert.ok(markdownForBlock({ text: atCharacterLimit }));
  plainFallback(atCharacterLimit + '。');

  // Each strong line includes two empty delimiter tokens in markdown-it.
  const atTokenLimit = [...Array(84).fill('**核对**'), '这行仍有预算', '继续核对', '节点边界的末尾'].join('\n');
  assert.ok(markdownForBlock({ text: atTokenLimit }));
  plainFallback(atTokenLimit + '\n另一行');
  plainFallback('开头\n\n' + '> '.repeat(35) + '深层引用的末尾\n\n普通的最后一段');
  plainFallback(Array.from({ length: 13 }, (_, i) => '  '.repeat(i) + '- 层级 ' + i).join('\n'));
});

test('block cache reuses formatting until its text changes', () => {
  const block = { text: '**原文**' };
  const first = markdownForBlock(block);
  assert.ok(first);
  assert.strictEqual(markdownForBlock(block), first);
  block.text = '*修订后*';
  const changed = markdownForBlock(block);
  assert.notStrictEqual(changed, first);
  assert.equal(changed[0].nodes[0].children[0].name, 'em');
});

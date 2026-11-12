const MarkdownIt = require('../vendor/markdown-it.umd.min');

const maxNesting = 20;
const parser = new MarkdownIt({ html: false, linkify: false, maxNesting });
const containerTags = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's',
  'blockquote', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
const maxAnswerChars = 16000;
const maxTokens = 512;
const renderedBlocks = new WeakMap();

function element(name, children = [], attrs = {}) {
  return { name, attrs: { class: 'md-' + name, ...attrs }, children };
}

function textNode(text) {
  return { type: 'text', text };
}

function appendTokens(tokens, root, budget) {
  const stack = [root];
  for (const token of tokens) {
    // markdown-it can stop reading input at its nesting limit. Use the original
    // text when the token stream may represent only part of the answer.
    if (--budget.remaining < 0 || token.level >= maxNesting - 1) return false;
    const children = stack[stack.length - 1];
    if (token.nesting) {
      // Links keep their inline label. Neither their destination nor any
      // model-supplied attributes enter the view.
      if (token.hidden || !containerTags.has(token.tag)) continue;
      if (token.nesting === -1) {
        stack.pop();
        continue;
      }
      const attrs = {};
      if (token.tag === 'ol') {
        const start = Number(token.attrGet('start') ?? 1);
        if (Number.isSafeInteger(start) && start >= 0 && start !== 1) attrs.start = start;
      }
      const node = element(token.tag, [], attrs);
      children.push(token.tag === 'table' ? element('div', [node], { class: 'md-table-scroll' }) : node);
      stack.push(node.children);
      continue;
    }
    switch (token.type) {
      case 'inline':
      case 'image':
        // Image alt text is readable; Markdown never initiates a download.
        if (!appendTokens(token.children || [], children, budget)) return false;
        break;
      case 'text':
      case 'text_special':
        if (token.content) children.push(textNode(token.content));
        break;
      case 'hardbreak':
      case 'softbreak':
        children.push(element('br'));
        break;
      case 'code_inline':
        children.push(element('code', [textNode(token.content)]));
        break;
      case 'fence':
      case 'code_block':
        children.push(element('pre', [element('code', [textNode(token.content.replace(/\n$/, ''))])]));
        break;
      case 'hr':
        children.push(element('hr'));
        break;
    }
  }
  return true;
}

function sectionsForView(nodes) {
  const sections = [];
  for (const node of nodes) {
    const kind = node.name === 'pre' ? 'code' : node.attrs?.class === 'md-table-scroll' ? 'table' : 'text';
    const previous = sections[sections.length - 1];
    if (kind === 'text' && previous?.kind === kind) {
      previous.nodes.push(node);
    } else {
      sections.push({ key: sections.length, kind, nodes: [node] });
    }
  }
  return sections;
}

function render(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > maxAnswerChars) return null;
  const tokens = parser.parse(text, {});
  const inline = tokens[1]?.children;
  if (tokens.length === 3 && tokens[0].type === 'paragraph_open'
    && inline?.length === 1 && inline[0].type === 'text' && inline[0].content === text) return null;
  const nodes = [];
  return appendTokens(tokens, nodes, { remaining: maxTokens }) && nodes.length ? sectionsForView(nodes) : null;
}

function markdownForBlock(block) {
  const text = block.text;
  const cached = renderedBlocks.get(block);
  if (cached && cached.text === text) return cached.sections;
  let sections = null;
  try {
    sections = render(text);
  } catch {
    // Preserve readable plain text if parsing fails.
  }
  // The message window owns these blocks. A replaced or discarded window
  // does not leave an independent cache of previously visible content.
  renderedBlocks.set(block, { text, sections });
  return sections;
}

module.exports = { markdownForBlock };

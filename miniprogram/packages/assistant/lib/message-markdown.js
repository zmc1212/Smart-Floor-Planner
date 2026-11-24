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
const sublistMarkerClass = 'md-sublist-marker';

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

function markNestedLists(nodes, insideItem = false) {
  for (const node of nodes) {
    if (!node.children) continue;
    if (insideItem && node.name === 'ul') {
      // Native rich-text keeps its circular marker when the WXSS changes it.
      // Supply the marker on the trusted nodes and keep the list structure.
      const hasSiblings = node.children.length > 1;
      node.attrs.style = 'padding-left: ' + (hasSiblings ? '1.2em' : '0');
      for (const item of node.children) {
        item.attrs.style = 'display: block; list-style-type: none; position: relative';
        if (hasSiblings) {
          item.children.unshift(element('span', [textNode('–')], {
            class: sublistMarkerClass, style: 'position: absolute; top: 0; left: -1em',
          }));
        }
      }
    }
    markNestedLists(node.children, insideItem || node.name === 'li');
  }
}

function render(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > maxAnswerChars) return null;
  const tokens = parser.parse(text, {});
  const inline = tokens[1]?.children;
  if (tokens.length === 3 && tokens[0].type === 'paragraph_open'
    && inline?.length === 1 && inline[0].type === 'text' && inline[0].content === text) return null;
  const nodes = [];
  if (!appendTokens(tokens, nodes, { remaining: maxTokens }) || !nodes.length) return null;
  markNestedLists(nodes);
  return sectionsForView(nodes);
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

// Parse the whole authorized prefix before revealing any of its text. This
// lets an opening heading or emphasis appear without flashing its delimiters.
function revealMarkdown(block, remaining) {
  const sections = markdownForBlock(block);
  if (!sections) return null;

  function revealNodes(nodes) {
    const visible = [];
    for (const node of nodes) {
      if (remaining <= 0) break;
      if (node.type === 'text') {
        const end = node.text.codePointAt(remaining - 1) > 0xffff ? remaining - 1 : remaining;
        const text = node.text.slice(0, end);
        if (text) visible.push(text === node.text ? node : textNode(text));
        remaining -= node.text.length;
      } else if (node.children.length) {
        const first = node.children[0];
        const marker = first.attrs?.class === sublistMarkerClass ? first : null;
        const children = revealNodes(marker ? node.children.slice(1) : node.children);
        if (children.length) visible.push({ ...node, children: marker ? [marker, ...children] : children });
      } else {
        visible.push(node);
      }
    }
    return visible;
  }

  return sections.flatMap(section => {
    const nodes = revealNodes(section.nodes);
    return nodes.length ? [{ ...section, nodes }] : [];
  });
}

const paragraphTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table']);

function copyNode(node) {
  if (node.type === 'text') return node.text;
  if (node.attrs?.class === sublistMarkerClass) return '';
  if (node.name === 'br') return '\n';
  const children = (node.children || []).map(copyNode);
  if (node.name === 'ol' || node.name === 'ul') {
    const first = node.attrs?.start ?? 1;
    return children.map((child, index) => {
      const marker = node.name === 'ol' ? (first + index) + '. ' : '• ';
      return marker + child.trim().replace(/\n/g, '\n' + ' '.repeat(marker.length));
    }).join('\n') + '\n\n';
  }
  if (node.name === 'tr') return children.join('\t') + '\n';
  return children.join('') + (paragraphTags.has(node.name) ? '\n\n' : '');
}

function copyableReplyText(message) {
  if (!message?.replyActions || !message.available || message.authorKind !== 'assistant') return '';
  return (message.content?.blocks || []).filter(block => block.type === 'text').map(block => {
    const rendered = markdownForBlock(block);
    return rendered ? rendered.flatMap(part => part.nodes).map(copyNode).join('').trim() : String(block.text || '').trim();
  }).filter(Boolean).join('\n\n');
}

module.exports = { markdownForBlock, revealMarkdown, copyableReplyText };

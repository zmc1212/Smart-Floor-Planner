function measureIntent(value) {
  const text = String(value || '');
  return /(需要|想|要|预约|安排|帮我).{0,8}(量房|测量)|量房.{0,8}(预约|安排|什么时候)/.test(text);
}

function measureInvite(value) {
  const text = String(value || '');
  return /(需要|要不要|可以|帮你).{0,12}(量房|上门测量)|量房.{0,12}(安排|预约)/.test(text);
}

module.exports = { measureIntent, measureInvite };

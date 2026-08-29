const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const actionsPath = path.resolve(__dirname, '..', 'components', 'commission-payout-actions', 'index.js');
const actionsTemplatePath = path.resolve(__dirname, '..', 'components', 'commission-payout-actions', 'index.wxml');
const actionsStylePath = path.resolve(__dirname, '..', 'components', 'commission-payout-actions', 'index.less');
const pageTemplatePath = path.resolve(__dirname, '..', 'packages', 'business', 'enterprise-commissions', 'enterprise-commissions.wxml');

function createActions(item, overrides = {}) {
  let definition = null;
  const previousComponent = global.Component;
  global.Component = (value) => { definition = value; };
  delete require.cache[actionsPath];
  require(actionsPath);
  if (previousComponent === undefined) delete global.Component;
  else global.Component = previousComponent;
  const events = [];
  const component = {
    ...definition.methods,
    data: { ...definition.data, item, ...overrides },
  };
  component.setData = (next) => Object.assign(component.data, next);
  component.triggerEvent = (name, detail) => events.push({ name, detail });
  component.events = events;
  return component;
}

test('every payable role uses one confirmation action and one amount dialog', () => {
  const template = fs.readFileSync(actionsTemplatePath, 'utf8');
  const pageTemplate = fs.readFileSync(pageTemplatePath, 'utf8');

  assert.match(template, />确认打款<\/button>/);
  assert.match(template, /请输入实际打款金额/);
  assert.doesNotMatch(template, /调整金额|确认线下付款|保存金额/);
  assert.match(pageTemplate, /item\.canConfirmPayment/);
  assert.doesNotMatch(pageTemplate, /quick-ledger|batch-action|可先调整应付金额/);
});

test('referrer payable row opens with its current amount prefilled', () => {
  const actions = createActions({
    id: '201', role: 'referrer', roleLabel: '推荐人', amount: '88.00', amountLabel: '¥88.00', status: 'payable',
  });
  const previousWx = global.wx;
  global.wx = { showToast() { assert.fail('a payable referrer row must open without an error toast'); } };

  actions.open();

  global.wx = previousWx;
  assert.equal(actions.data.visible, true);
  assert.equal(actions.data.item.roleLabel, '推荐人');
  assert.equal(actions.data.amount, '88.00');
});

test('zero payable row opens with a blank amount that must be filled', () => {
  const actions = createActions({ id: '202', roleLabel: '家装设计顾问', amount: '0.00', status: 'payable' });
  const previousWx = global.wx;
  global.wx = { showToast() {} };

  actions.open();

  global.wx = previousWx;
  assert.equal(actions.data.visible, true);
  assert.equal(actions.data.amount, '');
});

test('confirmation submits the final amount and marks the row paid in one request', async () => {
  const actions = createActions({
    id: '203', role: 'referrer', roleLabel: '推荐人', amount: '88.00', amountLabel: '¥88.00', status: 'payable',
  });
  const previousWx = global.wx;
  global.wx = { showToast() {} };
  actions.open();
  actions.data.amount = '108.50';

  const api = require('../utils/api.js');
  const previousRequest = api.request;
  const requests = [];
  api.request = async (url, method, body) => {
    requests.push({ url, method, body });
    return { success: true };
  };
  const toasts = [];
  global.wx = { showToast(options) { toasts.push(options.title); } };

  try {
    await actions.confirm();
  } finally {
    api.request = previousRequest;
    global.wx = previousWx;
  }

  assert.deepEqual(requests, [{
    url: '/miniprogram/enterprise-commissions/mark-paid',
    method: 'POST',
    body: { payments: [{ commissionId: '203', paidAmount: '108.50' }] },
  }]);
  assert.deepEqual(toasts, ['已确认打款']);
  assert.deepEqual(actions.events, [{ name: 'paid', detail: { id: '203', paidAmount: '108.50' } }]);
  assert.equal(actions.data.visible, false);
});

test('the prefilled amount may be confirmed without a separate adjustment step', async () => {
  const actions = createActions({ id: '204', amount: '88.00', status: 'payable' }, { visible: true, amount: '88.00' });
  const api = require('../utils/api.js');
  const previousRequest = api.request;
  let called = false;
  api.request = async () => { called = true; return { success: true }; };
  const previousWx = global.wx;
  global.wx = { showToast() {} };

  try {
    await actions.confirm();
  } finally {
    api.request = previousRequest;
    global.wx = previousWx;
  }

  assert.equal(called, true);
  assert.equal(actions.data.error, '');
});

test('confirmation rejects zero and malformed amounts before the request', async () => {
  const actions = createActions({ id: '205', status: 'payable' }, { visible: true, amount: '0' });

  await actions.confirm();
  assert.equal(actions.data.error, '请输入 0.01 至 999999999999.99，最多两位小数');

  actions.data.amount = '-1';
  await actions.confirm();
  assert.equal(actions.data.error, '请输入 0.01 至 999999999999.99，最多两位小数');

  actions.data.amount = '1000000000000';
  await actions.confirm();
  assert.equal(actions.data.error, '请输入 0.01 至 999999999999.99，最多两位小数');
});

test('failed confirmation keeps the dialog and entered amount for recovery', async () => {
  const actions = createActions({ id: '206', amount: '20.00', status: 'payable' }, { visible: true, amount: '25.00' });
  const api = require('../utils/api.js');
  const previousRequest = api.request;
  api.request = async () => { throw new Error('网络繁忙，请重试'); };
  const previousWx = global.wx;
  global.wx = { showToast() {} };

  try {
    await actions.confirm();
  } finally {
    api.request = previousRequest;
    global.wx = previousWx;
  }

  assert.equal(actions.data.visible, true);
  assert.equal(actions.data.amount, '25.00');
  assert.equal(actions.data.error, '网络繁忙，请重试');
});

test('confirmation dialog keeps native buttons inside the narrow-screen card', () => {
  const style = fs.readFileSync(actionsStylePath, 'utf8');

  assert.match(style, /\.dialog\s*\{[^}]*box-sizing:\s*border-box/);
  assert.match(style, /\.dialog-actions\s*\{[^}]*display:\s*flex/);
  assert.match(style, /\.cancel, \.save\s*\{[^}]*width:\s*0[^}]*min-width:\s*0[^}]*box-sizing:\s*border-box/);
  assert.doesNotMatch(style, /\.dialog-actions\s*\{[^}]*grid-template-columns/);
});

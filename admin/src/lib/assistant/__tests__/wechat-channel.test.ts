import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weixinApiOrigin, weixinClient, weixinOrigin } from '../wechat/ilink';

test('Weixin login, PIN and redirected polling use the documented transport and keep the bot token off login requests', async t => {
  for (const url of ['http://ilinkai.weixin.qq.com','https://example.com','https://x.weixin.qq.com:8000','https://x.weixin.qq.com@other.net'])
    assert.throws(() => weixinApiOrigin(url));
  const responses = [
    { qrcode: 'login-id', qrcode_img_content: 'https://example.test/qr' },
    { status: 'scaned_but_redirect', redirect_host: 'ilinkai2.weixin.qq.com' },
    { status: 'confirmed_but_need_verifycode' },
    { status: 'confirmed', bot_token: 'fixture', ilink_bot_id: 'bot', ilink_user_id: 'peer' },
    { status: 'confirmed', bot_token: 'fixture', ilink_bot_id: 'bot' },
  ];
  const calls: { url: URL; headers: Headers; method?: string; body?: BodyInit | null }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    calls.push({ url: new URL(input), headers: new Headers(init.headers), method: init.method, body: init.body });
    return Response.json(responses.shift());
  });
  const login = await weixinClient.login();
  assert.equal(login.code, 'login-id');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].body)), { local_token_list: [] });
  const next = await weixinClient.status(weixinOrigin, login.code);
  assert.ok(next.state === 'redirect');
  assert.deepEqual(await weixinClient.status(next.origin, login.code), { state: 'pin' });
  assert.deepEqual(await weixinClient.status(next.origin, login.code, '021305'), {
    state: 'confirmed', origin: next.origin, token: 'fixture', bot: 'bot', peer: 'peer',
  });
  assert.equal(calls[3].url.searchParams.get('verify_code'), '021305');
  assert.ok(calls.every(c => !c.headers.has('Authorization')));
  await assert.rejects(weixinClient.status(weixinOrigin, login.code), /wechat_protocol_error/);
});

test('Weixin accepts direct messages from the bound scanner and preserves distinct 64-bit IDs and reply receipts', async t => {
  const account = { origin: weixinOrigin, token: 'fake-token', bot: 'bot', peer: 'me' };
  const valid = { message_id: 'firstId', from_user_id: 'me', to_user_id: 'bot', message_type: 1, context_token: 'ctx',
    item_list: [{ type: 1, text_item: { text: '油漆怎么选？' } }] };
  const messages = [valid, { ...valid, message_id: 'secondId' }, { ...valid, from_user_id: 'someone' },
    { ...valid, group_id: 'group' }, { ...valid, to_user_id: 'other-bot' }, { ...valid, message_type: 2 },
    { ...valid, context_token: '' }, { ...valid, item_list: [{ type: 2 }], message_id: 'media' }];
  let op = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fake-token');
    if (op++ === 0) {
      assert.ok(url.endsWith('/getupdates')); assert.equal(body.get_updates_buf, 'previous');
      return new Response(JSON.stringify({ ret: 0, get_updates_buf: 'next', msgs: messages })
        .replace('"firstId"', '9223372036854775806').replace('"secondId"', '9223372036854775807'));
    }
    assert.ok(url.endsWith('/sendmessage'));
    assert.equal(body.msg.to_user_id, 'me'); assert.equal(body.msg.context_token, 'ctx');
    return Response.json(op === 2 ? { ret: 0 } : op === 3 ? { ret: -14 } : {});
  });
  const update = await weixinClient.updates(account, 'previous');
  assert.equal(update.cursor, 'next');
  assert.deepEqual(update.messages.map(m => m.text), ['油漆怎么选？','油漆怎么选？',null]);
  assert.notEqual(update.messages[0].key, update.messages[1].key);
  await weixinClient.reply(account, 'ctx', 'one', '答复');
  await assert.rejects(weixinClient.reply(account, 'ctx', 'two', '答复'), /wechat_login_invalid/);
  await assert.rejects(weixinClient.reply(account, 'ctx', 'three', '答复'), /wechat_delivery_unknown/);
});

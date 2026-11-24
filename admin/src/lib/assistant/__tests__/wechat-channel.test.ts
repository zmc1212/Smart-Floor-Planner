import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
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

test('Weixin uploads an encrypted original and sends one image item using the same recipient and context', async t => {
  const account = { origin: weixinOrigin, token: 'fake-token', bot: 'bot', peer: 'me' };
  const image = Buffer.from('fixture image bytes');
  let aeskey = '', filekey = '', count = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input), headers = new Headers(init.headers);
    count++;
    if (count === 1) {
      assert.equal(url.pathname, '/ilink/bot/getuploadurl');
      assert.equal(headers.get('Authorization'), 'Bearer fake-token');
      const request = JSON.parse(String(init.body));
      ({ aeskey, filekey } = request);
      assert.match(aeskey, /^[a-f0-9]{32}$/u);
      assert.equal(request.to_user_id, account.peer);
      assert.equal(request.media_type, 1);
      assert.equal(request.rawsize, image.length);
      assert.equal(request.fileSize, undefined);
      assert.equal(request.filesize, 32);
      assert.equal(request.rawfilemd5, createHash('md5').update(image).digest('hex'));
      assert.equal(request.no_need_thumb, true);
      return Response.json({ upload_param: 'signed+param' });
    }
    if (count === 2) {
      assert.equal(url.origin + url.pathname, 'https://novac2c.cdn.weixin.qq.com/c2c/upload');
      assert.equal(url.searchParams.get('encrypted_query_param'), 'signed+param');
      assert.equal(url.searchParams.get('filekey'), filekey);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.equal(headers.has('Authorization'), false);
      const decipher = createDecipheriv('aes-128-ecb', Buffer.from(aeskey, 'hex'), null);
      assert.deepEqual(Buffer.concat([decipher.update(init.body as Uint8Array), decipher.final()]), image);
      return new Response(null, { headers: { 'x-encrypted-param': 'download-ref' } });
    }
    assert.equal(url.pathname, '/ilink/bot/sendmessage');
    const { msg } = JSON.parse(String(init.body));
    assert.equal(msg.to_user_id, account.peer);
    assert.equal(msg.context_token, 'ctx');
    assert.equal(msg.client_id, 'report-event');
    assert.deepEqual(msg.item_list, [{ type: 2, image_item: { media: { encrypt_query_param: 'download-ref',
      aes_key: Buffer.from(aeskey, 'utf8').toString('base64'), encrypt_type: 1 }, mid_size: 32 } }]);
    return Response.json({ ret: 0 });
  });
  const item = await weixinClient.uploadImage(account, image);
  assert.equal(count, 2);
  await weixinClient.replyImage(account, 'ctx', 'report-event', item);
  assert.equal(count, 3);
});

test('a CDN upload fails before sending when the origin is unexpected or its receipt is missing', async t => {
  const account = { origin: weixinOrigin, token: 'fake-token', bot: 'bot', peer: 'me' };
  let call = 0;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    call++;
    if (call === 1) return Response.json({ upload_full_url: 'https://not-weixin.example/upload' });
    if (call === 2) return Response.json({ upload_full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/upload?ticket=123', upload_param: 'old' });
    assert.equal(input, 'https://novac2c.cdn.weixin.qq.com/c2c/upload?ticket=123');
    return new Response(null);
  });
  await assert.rejects(weixinClient.uploadImage(account, Buffer.from('image')), /wechat_protocol_error/);
  assert.equal(call, 1);
  await assert.rejects(weixinClient.uploadImage(account, Buffer.from('image')), /wechat_protocol_error/);
  assert.equal(call, 3);
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
    if (op === 5) return new Response('truncated');
    if (op === 6) return Response.json({ errcode: 1001 });
    return Response.json(op === 2 ? { ret: 0 } : op === 3 ? { ret: -14 } : {});
  });
  const update = await weixinClient.updates(account, 'previous');
  assert.equal(update.cursor, 'next');
  assert.deepEqual(update.messages.map(m => m.text), ['油漆怎么选？','油漆怎么选？',null]);
  assert.notEqual(update.messages[0].key, update.messages[1].key);
  await weixinClient.reply(account, 'ctx', 'one', '答复');
  await assert.rejects(weixinClient.reply(account, 'ctx', 'two', '答复'), /wechat_login_invalid/);
  await weixinClient.reply(account, 'ctx', 'three', '答复');
  await assert.rejects(weixinClient.reply(account, 'ctx', 'four', '答复'), SyntaxError);
  await assert.rejects(weixinClient.reply(account, 'ctx', 'five', '答复'), /wechat_provider_rejected/);
});

const { errorCopy } = require('../../../utils/assistant-client');

const native = (method, options) => new Promise((resolve, reject) => wx[method]({ ...options, success: resolve, fail: reject }));
const menu = async labels => (await native('showActionSheet', { itemList: labels })).tapIndex;
const notice = (title, content) => native('showModal', { title, content, showCancel: false });

async function selectProject(ctx, scope, client, headers, active) {
  if (scope?.projectId) return scope.projectId;
  let projects = ctx.projects || [], cursor = ctx.projectsNextCursor, offset = 0;
  while (active()) {
    if (offset >= projects.length && cursor) {
      const page = await client.read('/followups/' + ctx.bindingId, { afterProjectId: cursor }, headers);
      projects = projects.concat(page.projects || []);
      cursor = page.projectsNextCursor;
    }
    const choices = projects.slice(offset, offset + 5);
    if (!choices.length || !active()) return '';
    if (choices.length === 1 && !cursor && !offset) return String(choices[0].id);
    const more = offset + choices.length < projects.length || !!cursor;
    const index = await menu([...choices.map(p => p.name), ...(more ? ['更多工地'] : [])]);
    if (choices[index]) return String(choices[index].id);
    offset += choices.length;
  }
  return '';
}

async function showCode(channel, active) {
  if (!channel.qrImage) return;
  const confirmed = await native('showModal', { title: '连接微信 ClawBot',
    content: '打开二维码后用本人微信识别并确认。回到报告页，再点「微信订阅」完成关联。', confirmText: '查看二维码' });
  if (!confirmed.confirm || !active()) return;
  const file = wx.env.USER_DATA_PATH + '/xiaok-wechat-pair.png';
  await new Promise((resolve,reject)=> wx.getFileSystemManager().writeFile({ filePath:file,
    data:channel.qrImage.split(',')[1],encoding:'base64',success:resolve,fail:reject }));
  if (active()) await native('previewImage',{current:file,urls:[file]});
}

const roleAudiences = new Set(['customer', 'worker', 'designer', 'boss']);

function roleScopeCopy(audience) {
  if (audience === 'boss') return '本企业下你当前有权限的全部工地';
  if (audience === 'customer') return '本企业中你仍有权限的各自家工地（每个工地分别发送原独立报告，不合并为每期汇总）';
  return '本企业中你当前角色有权限的工地';
}

async function manageWechatSubscription() {
  if (this._wechatSubscriptionBusy || !this.followups || !this.data.followupContext) return;
  this._wechatSubscriptionBusy = true;
  const followups = this.followups, scope = this._boardScope, ctx = this.data.followupContext,
    epoch = followups.epoch, roleScope = roleAudiences.has(ctx.audience);
  const active = () => this._alive && this._shown && this._boardScope === scope &&
    this.data.followupContext?.bindingId === ctx.bindingId && followups.current(epoch);
  try {
    const headers = await followups.headers(), client = followups.client;
    const projectId = roleScope ? '' : await selectProject(ctx,scope,client,headers,active);
    if (!roleScope && (!projectId || !active())) return;
    if (!active()) return;
    const query = roleScope ? 'scope=role' : 'projectId=' + encodeURIComponent(projectId);
    const path = '/followups/' + ctx.bindingId + '/wechat?' + query;
    const read = () => client.read(path,{},headers);
    const post = body => client.read(path,body,headers,'POST');
    let state = await read();
    if (!active()) return;
    if (!state.published || !state.reports) {
      if (state.channel && state.channel.status !== 'closed') {
        const answer=await native('showModal',{title:'微信报告已停用',content:(roleScope ? roleScopeCopy(ctx.audience) + '的微信推送已停止。' : '当前工地的微信推送已停止。') + '需要断开本人微信关联吗？',confirmText:'断开关联'});
        if (answer.confirm && active()) await post({action:'disconnect',id:state.channel.id});
      } else await notice('微信订阅','本企业尚未发布主小K的微信报告能力。');
      return;
    }
    let c = state.channel;
    if (!c || c.status === 'closed') {
      const confirm = await native('showModal',{title:roleScope ? '关联本人微信（角色范围）' : '关联本人微信',content:roleScope
        ? '连接你本人微信的 ClawBot 私聊，接收' + roleScopeCopy(ctx.audience) + '的日报和周报。微信私聊与小程序相互独立，完整报告和权限仍以小程序为准。'
        : '连接后可以在微信里查本工地的报告。微信 ClawBot 私聊与小程序相互独立，完整报告和权限仍以小程序为准。日报和周报可分别订阅。',confirmText:'开始关联'});
      if (!confirm.confirm || !active()) return;
      c = (await post({action:'start'})).channel;
      if (c && active()) {
        const choice=await menu(['连接新的微信 ClawBot','已有主小K，复制绑定口令']);
        if(!active())return;
        if(choice===0) await showCode(c,active);
        else if(c.command) {
          await native('setClipboardData',{data:c.command});
          if(active())await notice('口令已复制','请把口令发到本企业主小K的微信会话，再回来选日报或周报。');
        }
      }
      return;
    }
    if (!c.match) {
      const result=await native('showModal',{title:'切换关联范围或身份',content:roleScope ? '先断开原微信关联和订阅，再按当前企业及本人范围重新连接。' : '先断开原微信关联和订阅，再为当前工地重新连接。',confirmText:'断开原关联'});
      if(result.confirm && active()) await post({action:'disconnect',id:c.id});
      return;
    }
    if (c.status === 'pending') {
      const choice=await menu(['我已扫码，检查连接','查看二维码','取消连接']);
      if (!active()) return;
      if (choice===1) { await showCode(c,active);return; }
      if (choice===2) { await post({action:'disconnect',id:c.id});return; }
      let pin;
      if(c.loginState==='pin') {
        const input=await native('showModal',{title:'微信验证码',editable:true,placeholderText:'输入微信显示的验证码'});
        if(!input.confirm || !active())return;
        pin=input.content.trim();
      }
      c=(await post({action:'poll',id:c.id,...(pin?{pin}:{})})).channel;
      if(!active())return;
      if(!c || c.status!=='connected') {
        await notice('微信连接',c?.loginState==='pin'?'微信需要验证码，请再次检查连接并输入手机显示的验证码。':c?.status==='pending'?'正在等待微信确认。':'二维码已失效，请重新关联。');return;
      }
    }
    if(!c.verified) {
      const choice=await menu(['复制本人绑定口令','断开连接']);
      if(!active())return;
      if(choice===1){await post({action:'disconnect',id:c.id});return;}
      if(!c.command)c=(await post({action:'renew',id:c.id,version:c.version})).channel;
      if(c?.command && active()){
        await native('setClipboardData',{data:c.command});
        if(active())await notice('口令已复制','把口令粘贴发给刚连接的微信 ClawBot。收到关联回执后，可在这里选择日报或周报。');
      }
      return;
    }
    while (active()) {
      const upgradeAvailable = roleScope && c.scope !== 'role';
      const choice = await menu([
        ...(upgradeAvailable ? ['升级为本人角色范围'] : []),
        (c.daily?'关闭':'接收')+'微信日报',
        (c.weekly?'关闭':'接收')+'微信周报',
        '断开微信关联',
      ]);
      if(!active())return;
      if (upgradeAvailable && choice === 0) {
        const confirm = await native('showModal',{title:'升级微信报告范围',content:'升级后将继续使用同一个微信 ClawBot，改为接收' + roleScopeCopy(ctx.audience) + '的报告；日报和周报需要重新选择。',confirmText:'确认升级'});
        if (!confirm.confirm || !active()) return;
        c = (await post({action:'upgrade',id:c.id,version:c.version})).channel;
        if (!active()) return;
        if (!c || c.scope !== 'role') {
          await notice('微信订阅','暂时无法升级为本人角色范围，请稍后重试。');
          return;
        }
        continue;
      }
      const selected = choice - (upgradeAvailable ? 1 : 0);
      if(selected===2) {
        const confirm=await native('showModal',{title:'断开微信关联',content:(roleScope ? '断开后停止按' + roleScopeCopy(ctx.audience) + '发送的微信报告推送。' : '断开后停止本工地的微信报告推送。'),confirmText:'断开'});
        if(confirm.confirm && active())await post({action:'disconnect',id:c.id});
      } else {
        await post({action:'preferences',id:c.id,version:c.version,daily:selected===0?!c.daily:c.daily,weekly:selected===1?!c.weekly:c.weekly});
        if(active())wx.showToast({title:'微信订阅已保存',icon:'success'});
      }
      return;
    }
  } catch(error) {
    if (active() && !/cancel/i.test(error?.errMsg || '')) await notice('微信订阅',errorCopy(error));
  } finally {this._wechatSubscriptionBusy=false;}
}
module.exports = { manageWechatSubscription };

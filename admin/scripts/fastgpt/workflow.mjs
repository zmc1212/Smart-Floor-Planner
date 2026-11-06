// FastGPT v4.17.4 canonical workflow, using the vendor's maintained node contract.
export function reportWorkflow(modelId) {
  const input = (key, value, valueType='string', renderTypeList=['hidden']) => ({ key, label:key, value, valueType, renderTypeList });
  const output = (key, valueType='string') => ({ id:key,key,label:key,valueType,type:'static' });
  const http = (id,name,method,url,outputs,body) => ({ nodeId:id,name,flowNodeType:'httpRequest468',
    position:{x:id==='load'?320:1040,y:100},showStatus:true,catchError:false,
    inputs:[input('system_httpMethod',method),input('system_httpTimeout',30,'number'),
      input('system_httpReqUrl',url),input('system_httpHeader',[{key:'Authorization',value:'Bearer {{reportTicket}}',type:'string'}],'any'),
      input('system_httpContentType','json'),input('system_httpJsonBody',body||'','any')],
    outputs:[output('httpRawResponse','any'),...outputs.map(k=>output(k))] });
  const nodes=[
    {nodeId:'start',name:'日报/周报任务',flowNodeType:'workflowStart',position:{x:0,y:100},inputs:[],outputs:[output('userChatInput')]},
    http('load','读取当前收件人获权事实','GET','http://host.docker.internal:18310/report-input',['input','instructions']),
    {nodeId:'compose',name:'按角色生成阶段注意事项',flowNodeType:'chatNode',version:'4.9.7',position:{x:680,y:100},showStatus:true,catchError:false,
      inputs:[input('modelId',modelId,'string',['settingLLMModel']),input('maxToken',1200,'number'),input('temperature',0.2,'number'),
        input('isResponseAnswerText',false,'boolean'),input('aiChatResponseFormat','json_object'),input('aiChatReasoning',false,'boolean'),input('aiChatReasoningEffort','none'),
        input('aiChatVision',false,'boolean'),input('history',0,'chatHistory'),
        input('systemPrompt',['load','instructions'],'string',['reference']),
        input('userChatInput',['load','input'],'string',['reference'])],outputs:[output('answerText')]},
    http('validate','回传原报告服务校验','POST','http://host.docker.internal:18310/report-result',['result'],'{{$compose.answerText$}}'),
    {nodeId:'reply',name:'返回待持久化结果',flowNodeType:'answerNode',position:{x:1380,y:100},
      inputs:[input('text',['validate','result'],'any',['reference'])],outputs:[]}
  ];
  const ids=nodes.map(n=>n.nodeId);
  const edges=ids.slice(0,-1).map((source,i)=>({source,sourceHandle:`${source}-source-right`,target:ids[i+1],targetHandle:`${ids[i+1]}-target-left`}));
  return {name:'小K四端日报周报 · 远端联调',intro:'日周共用；模型前获权取数，原服务保存投递与撤回。仅隔离开发验证。',type:'advanced',nodes,edges,
    chatConfig:{variables:[{id:'reportTicket',key:'reportTicket',label:'本次报告票据',description:'短期、单报告、按原业务权限校验的开发票据',type:'input',required:true}],questionGuide:{open:false}}};
}

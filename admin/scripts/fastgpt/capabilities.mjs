import {reportWorkflow} from './workflow.mjs';

const input=(key,value,valueType='string',renderTypeList=['hidden'])=>({key,label:key,value,valueType,renderTypeList});
const output=key=>({id:key,key,label:key,valueType:'string',type:'static'});
const endpoint=(id,name,method,path,outputs,body='')=>({nodeId:id,name,flowNodeType:'httpRequest468',position:{x:{load:320,model:680,confirm:1040}[id],y:100},showStatus:true,catchError:false,
  inputs:[input('system_httpMethod',method),input('system_httpTimeout',120,'number'),input('system_httpReqUrl','http://host.docker.internal:18310'+path),
    input('system_httpHeader',[{key:'Authorization',value:'Bearer {{workflowTicket}}',type:'string'}],'any'),input('system_httpContentType','json'),input('system_httpJsonBody',body,'any')],
  outputs:[{...output('httpRawResponse'),valueType:'any'},...outputs.map(output)]});
export function knowledgeWorkflow(){
 const nodes=[
  {nodeId:'start',name:'小K知识问答回合',flowNodeType:'workflowStart',position:{x:0,y:100},inputs:[],outputs:[output('userChatInput')]},
  endpoint('load','读取统一会话中的获权请求','GET','/knowledge-input',['question','requestHash']),
  endpoint('model','调用原小K模型网关和工具协议','POST','/knowledge-turn',['receipt'],'{"requestHash":"{{$load.requestHash$}}"}'),
  endpoint('confirm','核对原回合回执和当前权限','POST','/knowledge-result',['receipt'],'{"receipt":"{{$model.receipt$}}"}'),
  {nodeId:'reply',name:'交回原小K继续处理',flowNodeType:'answerNode',position:{x:1380,y:100},inputs:[input('text',['confirm','receipt'],'any',['reference'])],outputs:[]}
 ];
 return{name:'小K装修知识问答 · 开发联调',type:'advanced',intro:'统一小K会话；FastGPT编排原模型网关，保留原工具、检索、记忆、引用和业务回执。',nodes,
  edges:nodes.slice(0,-1).map((n,i)=>({source:n.nodeId,sourceHandle:n.nodeId+'-source-right',target:nodes[i+1].nodeId,targetHandle:nodes[i+1].nodeId+'-target-left'})),
  chatConfig:{variables:[{id:'workflowTicket',key:'workflowTicket',label:'本次回合票据',description:'短期、单回合、原业务权限校验',type:'input',required:true}],questionGuide:{open:false}}};
}
export function stageWorkflow(modelId){
 const workflow=reportWorkflow(modelId);workflow.name='小K装修阶段提醒 · 开发联调';workflow.intro='真实阶段事件触发；原服务权限、校验、幂等投递与撤回。';
 workflow.nodes[0].name='真实装修阶段变更';workflow.nodes[2].name='生成本阶段通用提醒';return workflow;
}

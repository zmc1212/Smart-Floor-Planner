import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const ROOT = "G:/workspace/向总/Smart-Floor-Planner";
const OUT = path.join(ROOT, "customer-materials");
const asset = (...parts) => path.join(ROOT, ...parts);
const C = { green: "#20A36B", dark: "#143A31", mint: "#EAF7F0", lime: "#BDE9CA", ink: "#172B26", fog: "#F4F8F5", white: "#FFFFFF", muted: "#63756F", blue: "#2E6CF6", coral: "#EA715D" };

async function bytes(file) { const b = await fs.readFile(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
function rect(s,x,y,w,h,fill=C.white,r="rounded-xl") { return s.shapes.add({geometry:"roundRect",position:{left:x,top:y,width:w,height:h},fill,line:{style:"solid",fill:"none",width:0},borderRadius:r}); }
function txt(s,v,x,y,w,h,size=20,color=C.ink,bold=false,align="left") { const a=s.shapes.add({geometry:"textbox",position:{left:x,top:y,width:w,height:h},fill:"none",line:{style:"solid",fill:"none",width:0}}); a.text=v; a.text.style={fontFace:"Microsoft YaHei",fontSize:size,color,bold,alignment:align,verticalAlignment:"middle",marginLeft:0,marginRight:0,marginTop:0,marginBottom:0}; return a; }
async function pic(s,file,x,y,w,h,label,fit="cover") { s.images.add({blob:await bytes(file),contentType:"image/png",alt:label,fit,position:{left:x,top:y,width:w,height:h},geometry:"roundRect",borderRadius:"rounded-xl"}); }
function line(s,x1,y1,x2,y2,color="#B9DCC7",width=2) { s.shapes.add({geometry:"line",position:{left:x1,top:y1,width:x2-x1,height:y2-y1},fill:"none",line:{style:"solid",fill:color,width}}); }
function tag(s,label,n) { txt(s,label.toUpperCase(),64,42,360,22,12,C.green,true); txt(s,`家客来  /  ${String(n).padStart(2,"0")}`,1030,43,180,20,10,C.muted,false,"right"); }
function foot(s) { txt(s,"装修企业的客户经营与空间服务工作台",64,679,500,18,10,C.muted); }
function notes(s, text) { s.speakerNotes.textFrame.setText([text,"[Sources] 本页产品能力与页面截图来自仓库当前模块清单、已批准设计参考和本地品牌资产。"]); s.speakerNotes.setVisible(true); }
function caption(s,number,title,body,x,y,w) { txt(s,number,x,y,44,26,13,C.green,true); txt(s,title,x,y+33,w,32,23,C.ink,true); txt(s,body,x,y+75,w,45,16,C.muted); }
const P = (...items) => asset("design-references","all-pages-ip-v1",...items);

await fs.mkdir(OUT,{recursive:true});
const deck=Presentation.create({slideSize:{width:1280,height:720}});
let s;

// 1. Cover
s=deck.slides.add(); s.background.fill=C.dark;
await pic(s,asset("design-references","brand-concepts","jiakuke-logo-v1.png"),64,52,70,70,"家客来Logo","contain");
txt(s,"家客来",151,64,210,35,30,C.white,true);
txt(s,"让装修企业的每一位成员\n围绕同一个客户协同工作",64,174,700,140,50,C.white,true);
txt(s,"线索  ·  正式量房  ·  AI方案  ·  设计协作  ·  企业管理",67,355,720,30,19,"#BDE9CA",true);
await pic(s,asset("design-references","brand-concepts","d-fusion-f3-dual-state-v1.png"),875,98,290,470,"小K空间变形品牌视觉","contain");
txt(s,"面向装修公司负责人的产品介绍",67,640,340,20,13,"#9ACCAE");
notes(s,"开场：今天只讲一件事，怎样让测量员、设计师和企业负责人围绕同一个客户协同工作。不要先讲功能清单。");

// 2. One customer story
s=deck.slides.add(); s.background.fill=C.fog; tag(s,"一个客户，三个人协同",2);
txt(s,"客户不应在不同人的手机里\n重新开始三次",64,92,610,108,42,C.ink,true);
txt(s,"从现场尺寸，到方案沟通，再到企业负责人看到进度，\n每一步都应该接得上。",64,220,570,54,19,C.muted);
await pic(s,P("08-lead-detail.png"),740,110,180,480,"客户详情页面");
await pic(s,P("03-surveying-editor-idle.png"),920,165,180,420,"正式量房页面");
await pic(s,P("15-ai-design-result.png"),1080,220,150,360,"AI设计结果页面");
rect(s,65,366,570,132,C.white); caption(s,"一条客户主线","客户信息、正式户型和方案任务都围绕同一客户归集","老板看的不是多个孤岛工具，而是一条可推进的服务过程。",92,391,500); foot(s);
notes(s,"转场：先用一个客户的视角解释问题。页面拼贴代表客户档案、量房与设计结果的连续关系。");

// 3. Roles
s=deck.slides.add(); s.background.fill=C.white; tag(s,"企业内的三角色协同",3);
txt(s,"测量员、设计师、企业负责人\n各做该做的事",64,86,660,100,41,C.ink,true);
line(s,300,380,500,380,"#9FD8B4",3); line(s,735,380,935,380,"#9FD8B4",3);
const roles=[
 ["测量员","客户现场信息\n正式量房与保存","03-surveying-editor-idle.png",80,C.green],
 ["设计师","接收客户交接\n基于户型推进方案","04-ai-design-home.png",515,C.blue],
 ["企业负责人","看客户进度\n管人员、权限与规则","05-mine.png",950,C.coral]
];
for (const [name,body,file,x,color] of roles) { rect(s,x,232,250,335,C.fog); await pic(s,P(file),x+60,253,130,198,`${name}页面`); txt(s,name,x+28,476,190,30,25,color,true); txt(s,body,x+28,516,200,44,15,C.muted); }
foot(s); notes(s,"角色解释：客户可见模型只有三类企业角色。测量员建立空间信息，设计师推进方案，企业负责人管理过程和规则。");

// 4. Closed-loop visual
s=deck.slides.add(); s.background.fill=C.dark;
txt(s,"同一条客户链路，\n把现场工作和企业管理接在一起",64,70,690,105,42,C.white,true);
await pic(s,P("00-overview-customer-enterprise.png"),780,48,420,590,"客户与企业能力总览","contain");
const chain=[["01","客户进入"],["02","正式量房"],["03","方案推进"],["04","协作确认"],["05","负责人管理"]];
chain.forEach((v,i)=>{const x=66+i*132; rect(s,x,465,112,86,i===2?C.green:"#245446"); txt(s,v[0],x+16,482,40,18,12,"#BDE9CA",true); txt(s,v[1],x+16,510,82,24,14,C.white,true); if(i<4) line(s,x+112,508,x+130,508,"#75B691",2);});
txt(s,"一个客户，一份正式户型，一条可追踪的服务过程。",66,612,700,26,18,"#BDE9CA",true);
notes(s,"闭环：用这一页建立后续所有产品展示的主线。不要说成所有客户都会自动成交，而是帮助团队把过程接起来。");

// 5. Leads as command center
s=deck.slides.add(); s.background.fill=C.white; tag(s,"从客户档案开始",5);
txt(s,"客户档案是团队协同的起点",64,88,680,54,40,C.ink,true);
await pic(s,P("02-leads-management.png"),64,182,285,455,"线索管理页面");
await pic(s,P("08-lead-detail.png"),372,222,245,405,"客户详情页面");
rect(s,670,190,500,370,C.mint); caption(s,"01","客户信息入库","客户姓名、电话、社区、面积与风格，形成可继续服务的客户档案。",708,220,410); caption(s,"02","状态有序推进","新线索、量房中、设计方案、已签约，给负责人一条清楚的业务轨迹。",708,340,410); caption(s,"03","户型与客户关联","正式量房不再是孤立文件，而是该客户后续设计和协作的底图。",708,460,410); foot(s);
notes(s,"演示：打开线索页和客户详情。强调客户状态和正式量房关联，不把设计师交接确认误说成量房前置步骤。");

// 6. Measurement craft
s=deck.slides.add(); s.background.fill=C.fog; tag(s,"正式量房",6);
txt(s,"不是拍一张户型图，\n而是建立可用的空间底图",64,90,650,100,41,C.ink,true);
await pic(s,P("03-surveying-editor-idle.png"),64,230,225,382,"量房初始状态");
await pic(s,P("18-surveying-editor-active.png"),318,180,225,432,"量房活动状态");
await pic(s,P("20-surveying-editor-opening-selected.png"),572,230,225,382,"门窗编辑状态");
rect(s,840,164,330,408,C.dark); txt(s,"正式量房\n能留下什么？",875,202,240,68,28,C.white,true);
txt(s,"毫米级墙图\n门窗与闭合空间\n草稿恢复与云端保存\n测量审计",875,300,215,150,19,"#D8F1E2",true);
txt(s,"手动输入 + 兼容 BLE 测距",875,493,230,35,16,"#9FE0B8",true); foot(s);
notes(s,"演示：画墙、输入长度、门窗、保存；有设备才尝试BLE。口径：BLE依赖兼容硬件、手机授权与现场连接条件。");

// 7. From plan to design
s=deck.slides.add(); s.background.fill=C.dark;
txt(s,"一份正式户型，\n让设计师更快进入方案沟通",64,72,680,100,42,C.white,true);
await pic(s,P("03-surveying-editor-idle.png"),78,250,175,330,"正式量房底图");
line(s,275,416,370,416,"#8ED5A8",3); txt(s,"正式户型",78,594,175,24,15,"#A9DABB",true);
await pic(s,P("04-ai-design-home.png"),390,190,200,390,"AI设计首页");
line(s,610,416,705,416,"#8ED5A8",3); txt(s,"选择整户或单空间",380,594,230,24,15,"#A9DABB",true);
await pic(s,P("15-ai-design-result.png"),725,190,200,390,"AI设计结果"); txt(s,"方案参考与结果历史",720,594,230,24,15,"#A9DABB",true);
rect(s,965,235,220,230,"#245446"); txt(s,"AI 的正确定位",995,270,170,28,20,"#BDE9CA",true); txt(s,"帮助团队\n表达方案、比较方向、\n保留任务过程。",995,322,155,78,18,C.white,true); txt(s,"不是施工图\n不是自动成交",995,445,155,50,15,"#A8DABB",true);
notes(s,"演示：展示已准备好的成功结果和历史。明确AI用于方案参考与概念表达，依赖企业配置、额度和有效正式户型。");

// 8. Collaboration
s=deck.slides.add(); s.background.fill=C.white; tag(s,"测量员与设计师协作",8);
txt(s,"交接不靠口头确认，\n每一次协作都有回执",64,86,650,100,41,C.ink,true);
await pic(s,P("08-lead-detail.png"),70,227,185,355,"客户详情中的协作信息");
await pic(s,P("05-mine.png"),280,184,185,398,"消息与工作入口");
await pic(s,P("12-commission-records.png"),490,227,185,355,"提成记录页");
rect(s,760,193,410,322,C.mint); txt(s,"测量员",800,228,120,28,21,C.green,true); txt(s,"提交客户后查看通知、交接回执与待结算记录。",800,265,320,46,18,C.ink,true); txt(s,"确认交接不会改变客户业务状态，也不阻断量房与设计。",800,313,320,34,15,C.muted); line(s,800,363,1120,363,"#B9DCC7",1); txt(s,"设计师",800,382,120,28,21,C.blue,true); txt(s,"在协作工作台确认客户微信交接。",800,419,320,34,18,C.ink,true); txt(s,"负责人设置人员绑定、固定提成规则，并进行人工结算。",800,458,320,34,15,C.muted); foot(s);
notes(s,"演示：测量员创建客户，设计师确认交接，测量员查看通知和回执。强调这是企业内部协作，自动打款当前未开放。");

// 9. Owner view
s=deck.slides.add(); s.background.fill=C.mint; tag(s,"企业负责人",9);
txt(s,"负责人不需要替团队做事，\n但需要看见过程与边界",64,86,710,100,41,C.ink,true);
await pic(s,P("00-overview-core.png"),760,95,420,485,"核心能力总览","contain");
const owner=[["客户过程","线索、量房、设计任务的真实状态"],["团队边界","员工角色、企业权限与数据范围"],["设备与规则","设备绑定、AI额度、提成规则与人工结算"]];
owner.forEach((a,i)=>{const y=245+i*110; rect(s,66,y,575,82,C.white); txt(s,`0${i+1}`,94,y+28,40,22,13,C.green,true); txt(s,a[0],152,y+20,150,26,20,C.ink,true); txt(s,a[1],315,y+22,290,24,16,C.muted);});
txt(s,"把客户资产和服务过程沉淀在企业，而不是散落在个人工具里。",66,610,660,28,18,C.ink,true);
notes(s,"管理：负责人重点看过程、团队边界和企业规则。仅展示当前已具备的管理功能，不做没有证据的经营收益承诺。");

// 10. Evidence and boundaries
s=deck.slides.add(); s.background.fill=C.white; tag(s,"把能力讲清楚",10);
txt(s,"真实能力，才值得进入企业日常",64,88,720,54,40,C.ink,true);
const facts=[["已具备","线索管理、正式量房、手动与兼容 BLE 测距、AI 工作流、协作通知、权限与企业管理",C.green],["需满足条件","BLE依赖硬件和授权；AI依赖企业配置、额度、有效正式户型和当前权限",C.blue],["当前不承诺","自动打款、银行代发、小程序完整量房报告导出；AI不等同施工图或自动成交",C.coral]];
facts.forEach((a,i)=>{const y=206+i*125; rect(s,64,y,1080,92,i===0?C.mint:C.fog); txt(s,a[0],94,y+29,150,28,20,a[2],true); txt(s,a[1],292,y+22,810,44,17,C.ink);});
await pic(s,asset("design-references","brand-concepts","d-fusion-f1-solid-friendly-v1.png"),1010,525,115,120,"小K品牌角色","contain");
txt(s,"值得信任的产品，不是承诺一切，而是清楚地帮助团队把每一步做好。",64,610,820,30,19,C.green,true);
notes(s,"边界：主动讲清BLE、AI与结算边界。客户会更容易相信我们演示的每一项真实能力。");

// 11. Live demo path
s=deck.slides.add(); s.background.fill=C.dark;
txt(s,"会议现场，带您走一遍\n真实的客户服务过程",64,78,700,95,42,C.white,true);
const demo=[["客户档案","线索录入与详情","02-leads-management.png"],["正式量房","墙图、尺寸与保存","18-surveying-editor-active.png"],["方案推进","正式户型进入AI设计","15-ai-design-result.png"]];
for (let i=0;i<demo.length;i++) { const [t,b,f]=demo[i]; const x=64+i*365; await pic(s,P(f),x,240,180,280,t); txt(s,`0${i+1}`,x+206,256,40,20,12,"#A8DABB",true); txt(s,t,x+206,287,140,28,20,C.white,true); txt(s,b,x+206,326,140,45,15,"#D8F1E2"); }
txt(s,"备用方案：网络、账号、蓝牙或AI服务不稳定时，切换本地视频和预置成功样例。",64,614,930,26,17,"#A8DABB",true);
notes(s,"现场演示顺序：客户档案 → 正式量房 → AI设计 → 协作确认 → 企业管理。异常时播放本地备用视频，不把外部依赖失败解释为产品能力。");

// 12. CTA
s=deck.slides.add(); s.background.fill=C.dark;
await pic(s,asset("design-references","brand-concepts","d-fusion-f3-dual-state-v1.png"),855,95,270,470,"小K空间变形品牌视觉","contain");
txt(s,"下一步，安排一场\n属于贵公司的试用演示",64,112,660,120,49,C.white,true);
txt(s,"选择一个真实客户场景，\n让测量员、设计师和负责人一起验证流程。",67,282,610,58,20,"#D8F1E2");
rect(s,67,411,560,132,C.white); txt(s,"待替换：预约二维码 / 联系人微信 / 电话",102,460,480,28,18,C.ink,true);
txt(s,"用真实业务，而不是想象中的功能，判断家客来是否适合你的团队。",67,610,700,28,19,"#BDE9CA",true);
notes(s,"收口：只推动一个动作，预约企业试用演示。会前替换二维码、联系人和试用入口。");

const output=path.join(OUT,"家客来-客户推广会-三角色协同优化版.pptx");
const exported=await PresentationFile.exportPptx(deck); await exported.save(output);
const build=path.join(ROOT,"scratch","customer-materials-build");
for(let i=0;i<deck.slides.items.length;i++){const png=await deck.export({slide:deck.slides.items[i],format:"png",scale:1});await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,"0")}.png`),new Uint8Array(await png.arrayBuffer()));}
const montage=await deck.export({format:"webp",montage:true,scale:1});await fs.writeFile(path.join(build,"deck-montage.webp"),new Uint8Array(await montage.arrayBuffer()));
console.log(output);

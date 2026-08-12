import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const ROOT = "G:/workspace/向总/Smart-Floor-Planner";
const OUT = path.join(ROOT, "customer-materials");
const A = (...parts) => path.join(ROOT, ...parts);
const C = { green:"#20A36B", dark:"#143A31", mint:"#EAF7F0", fog:"#F4F8F5", ink:"#172B26", white:"#FFFFFF", muted:"#63756F", blue:"#2E6CF6", coral:"#EA715D", lime:"#BDE9CA" };
async function bytes(file){const b=await fs.readFile(file);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}
function shape(s,x,y,w,h,fill=C.white,r="rounded-xl"){return s.shapes.add({geometry:"roundRect",position:{left:x,top:y,width:w,height:h},fill,line:{style:"solid",fill:"none",width:0},borderRadius:r});}
function text(s,v,x,y,w,h,size=20,color=C.ink,bold=false,align="left"){const q=s.shapes.add({geometry:"textbox",position:{left:x,top:y,width:w,height:h},fill:"none",line:{style:"solid",fill:"none",width:0}});q.text=v;q.text.style={fontFace:"Microsoft YaHei",fontSize:size,color,bold,alignment:align,verticalAlignment:"middle",marginLeft:0,marginRight:0,marginTop:0,marginBottom:0};return q;}
function connector(s,x1,y1,x2,y2,color="#A8D7B7",width=3){s.shapes.add({geometry:"line",position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)},fill:"none",line:{style:"solid",fill:color,width}});}
async function image(s,file,x,y,w,h,alt,fit="cover"){s.images.add({blob:await bytes(file),contentType:"image/png",alt,fit,position:{left:x,top:y,width:w,height:h},geometry:"roundRect",borderRadius:"rounded-xl"});}
function header(s,eyebrow,title,n){text(s,eyebrow.toUpperCase(),64,42,410,22,12,C.green,true);text(s,title,64,78,900,76,39,C.ink,true);text(s,`家客来  /  ${String(n).padStart(2,"0")}`,1030,43,180,20,10,C.muted,false,"right");}
function footer(s){text(s,"装修企业的客户经营与空间服务工作台",64,679,500,18,10,C.muted);}
function note(s,body){s.speakerNotes.textFrame.setText([body,"[Sources] 产品能力来自仓库当前模块清单、正式量房文档、获客协作契约和已批准设计参考；界面图来自 design-references/all-pages-ip-v1。"]);s.speakerNotes.setVisible(true);}
const P=(...x)=>A("design-references","all-pages-ip-v1",...x);
await fs.mkdir(OUT,{recursive:true});
const deck=Presentation.create({slideSize:{width:1280,height:720}});let s;

// 1 cover: orient the audience around one mental model
s=deck.slides.add();s.background.fill=C.dark;
await image(s,A("design-references","brand-concepts","jiakuke-logo-v1.png"),64,50,72,72,"家客来 Logo","contain");text(s,"家客来",155,61,180,36,31,C.white,true);
text(s,"装修企业数字化服务系统\n一张图看懂",64,168,620,120,50,C.white,true);
text(s,"客户经营  ×  正式量房  ×  AI设计  ×  企业管理",67,332,700,30,20,C.lime,true);
shape(s,780,128,390,390,"#1D4C40");
text(s,"家客来",875,272,200,55,42,C.white,true,"center");
text(s,"围绕同一个客户\n让三类角色协同工作",845,342,260,65,20,C.lime,true,"center");
connector(s,920,245,850,182,"#8ED5A8",2);connector(s,1010,245,1085,182,"#8ED5A8",2);connector(s,920,390,850,470,"#8ED5A8",2);connector(s,1010,390,1085,470,"#8ED5A8",2);
text(s,"客户",785,153,130,28,18,C.white,true,"center");text(s,"空间",1052,153,130,28,18,C.white,true,"center");text(s,"方案",785,472,130,28,18,C.white,true,"center");text(s,"管理",1052,472,130,28,18,C.white,true,"center");
await image(s,A("design-references","brand-concepts","d-fusion-f3-dual-state-v1.png"),1075,540,125,135,"小K空间变形角色","contain");
text(s,"面向装修公司负责人 / 测量员 / 设计师",67,642,430,20,13,"#9ACCAE");note(s,"开场：这不是功能清单，而是一张系统地图。今天沿着中心节点和四个分支看完整产品。每页只回答地图上的一个问题。");

// 2 system map: the whole product in one view
s=deck.slides.add();s.background.fill=C.fog;header(s,"系统总览","家客来 = 一个中心，四个业务分支",2);
// connectors first
connector(s,640,360,290,190,"#86C89D",4);connector(s,640,360,990,190,"#86C89D",4);connector(s,640,360,290,530,"#86C89D",4);connector(s,640,360,990,530,"#86C89D",4);
shape(s,525,285,230,145,C.green);text(s,"家客来",557,311,166,38,30,C.white,true,"center");text(s,"装修企业\n客户经营与空间服务",552,358,176,42,15,"#E2F7E9",true,"center");
const branches=[
 ["客户经营","线索 / 客户档案 / 状态推进",90,132,C.white,"02-leads-management.png"],
 ["正式量房","墙图 / 门窗 / BLE / 保存",835,132,C.white,"03-surveying-editor-idle.png"],
 ["AI设计","整户 / 单空间 / 方案历史",90,472,C.white,"04-ai-design-home.png"],
 ["企业管理","角色 / 权限 / 设备 / 规则",835,472,C.white,"00-overview-core.png"]
];
for(const [title,desc,x,y,fill,file] of branches){shape(s,x,y,310,130,fill);text(s,title,x+24,y+23,220,30,24,C.ink,true);text(s,desc,x+24,y+67,260,30,15,C.muted);await image(s,P(file),x+238,y+18,56,92,`${title}页面`,"contain");}
text(s,"中心不变：一个客户主线，贯穿四个分支。",64,625,700,24,18,C.green,true);footer(s);note(s,"总览讲法：只讲一次全局。客户经营负责‘客户是谁’，正式量房负责‘空间是什么’，AI设计负责‘方案怎么表达’，企业管理负责‘谁能看、谁来协作、规则如何落地’。");

// 3 role map
s=deck.slides.add();s.background.fill=C.white;header(s,"角色地图","三个角色，围绕一份客户档案协同",3);
connector(s,248,398,508,398,"#9FD8B4",3);connector(s,772,398,1032,398,"#9FD8B4",3);
const roleData=[
 ["测量员","把现场变成可用的空间底图","客户录入\n正式量房\n保存与继续",80,C.green,"03-surveying-editor-idle.png"],
 ["设计师","把客户和户型推进到方案沟通","承接交接\n启动 AI 设计\n查看任务历史",515,C.blue,"04-ai-design-home.png"],
 ["企业负责人","把过程、人员和规则放在企业里","查看进度\n管理权限\n设备与结算规则",950,C.coral,"05-mine.png"]
];
for(const [name,claim,body,x,color,file] of roleData){shape(s,x,220,250,310,C.fog);await image(s,P(file),x+67,240,116,156,`${name}界面`);text(s,name,x+28,414,190,30,25,color,true);text(s,claim,x+28,454,195,46,16,C.ink,true);text(s,body,x+28,512,192,54,15,C.muted);}
text(s,"角色分工不是三套系统，而是同一条客户主线的三个观察角度。",64,615,920,25,18,C.green,true);footer(s);note(s,"角色地图：这一页替代原来多页重复的老板价值和现场人员价值。强调三角色共用客户、户型和协作事实。");

// 4 lifecycle map
s=deck.slides.add();s.background.fill=C.dark;header(s,"客户主线","沿着客户主线，系统在不同节点接力",4);text(s,"一条主线，五个节点",64,160,400,30,20,C.lime,true);
const life=[
 ["01","客户进入","姓名 / 电话 / 社区", "02-leads-management.png"],
 ["02","量房建底图","墙图 / 尺寸 / 门窗", "18-surveying-editor-active.png"],
 ["03","方案表达","整户 / 单空间 AI", "15-ai-design-result.png"],
 ["04","协作确认","通知 / 回执 / 提成", "12-commission-records.png"],
 ["05","负责人管理","过程 / 权限 / 规则", "00-overview-core.png"]
];
life.forEach((v,i)=>{const x=64+i*232;if(i<4)connector(s,x+192,425,x+228,425,"#79B894",2);shape(s,x,272,192,248,i===2?C.green:"#1D4C40");text(s,v[0],x+18,292,40,20,12,"#BDE9CA",true);text(s,v[1],x+18,326,150,28,21,C.white,true);text(s,v[2],x+18,370,150,40,15,"#D8F1E2");image(s,P(v[3]),x+18,426,156,78,`${v[1]}页面`);});
text(s,"只需要记住：客户档案是起点，正式户型是底图，企业负责人看到的是全过程。",64,586,1050,28,19,C.lime,true);footer(s);note(s,"客户主线：用一页说明各模块的关系，后续不再重复用‘闭环’或‘过程可视’作为标题。");

// 5 survey branch
s=deck.slides.add();s.background.fill=C.fog;header(s,"分支一 · 正式量房","正式量房，把现场信息变成设计可用的空间底图",5);
await image(s,P("03-surveying-editor-idle.png"),64,178,210,390,"量房初始状态");await image(s,P("18-surveying-editor-active.png"),304,145,210,423,"量房活动状态");await image(s,P("20-surveying-editor-opening-selected.png"),544,178,210,390,"门窗编辑状态");
shape(s,826,170,340,402,C.dark);text(s,"这条分支只回答一个问题",861,211,260,26,16,C.lime,true);text(s,"空间底图\n如何变得可信？",861,253,260,70,30,C.white,true);text(s,"毫米级墙图\n门窗与闭合空间\n草稿恢复与云端保存\n手动 + 兼容 BLE 测距",861,355,240,125,19,"#D8F1E2",true);text(s,"BLE依赖兼容硬件、授权与连接状态。",861,505,245,36,15,"#9FE0B8",true);footer(s);note(s,"分支说明：只讲正式量房产生什么，不再重复介绍整个系统。演示优先画墙、输入尺寸、门窗、保存。");

// 6 design branch
s=deck.slides.add();s.background.fill=C.dark;header(s,"分支二 · AI设计","正式户型进入 AI 设计，形成可沟通的方案方向",6);
await image(s,P("03-surveying-editor-idle.png"),64,200,180,330,"正式量房底图");connector(s,255,360,360,360,"#8ED5A8",3);await image(s,P("04-ai-design-home.png"),380,160,200,390,"AI设计首页");connector(s,592,360,697,360,"#8ED5A8",3);await image(s,P("15-ai-design-result.png"),720,160,200,390,"AI设计结果");
shape(s,965,205,235,270,"#1D4C40");text(s,"分支结果",997,237,170,24,16,C.lime,true);text(s,"从一份户型\n到一组方案方向",997,278,166,68,25,C.white,true);text(s,"整户 / 单空间\n历史 / 进度 / 重试",997,380,166,56,17,"#D8F1E2",true);text(s,"AI 是方案参考，不是施工图。",64,595,540,26,18,C.lime,true);footer(s);note(s,"分支说明：AI只出现一次。展示‘正式户型 → 目标选择 → 结果历史’三步，不重复讲企业价值。");

// 7 management branch
s=deck.slides.add();s.background.fill=C.mint;header(s,"分支三 · 企业管理","负责人在后台管理‘人、数据、设备和规则’",7);
await image(s,P("00-overview-core.png"),720,105,470,480,"企业能力总览","contain");
const mg=[ ["人","员工角色与企业权限",80,190,C.green],["数据","客户、户型、协作与归档",80,320,C.blue],["设备","绑定状态与授权使用",80,450,C.coral],["规则","AI额度、提成与人工结算",400,450,"#7C5CE5"] ];
for(const [head,desc,x,y,color] of mg){shape(s,x,y,270,95,C.white);text(s,head,x+22,y+19,40,36,27,color,true);text(s,desc,x+80,y+22,165,40,16,C.ink,true);}
text(s,"负责人看的是‘系统是否在按企业规则运行’。",80,590,530,26,18,C.ink,true);footer(s);note(s,"分支说明：管理端只讲人、数据、设备和规则四个对象，避免重复罗列后台菜单。");

// 8 boundary + demo + CTA
s=deck.slides.add();s.background.fill=C.dark;
text(s,"带着这张地图，现场走一遍真实流程",64,66,720,55,39,C.white,true);
const route=[["客户档案","测量员"],["正式量房","测量员"],["AI方案","设计师"],["协作回执","设计师"],["企业管理","负责人"]];
route.forEach((v,i)=>{const x=64+i*190;if(i<4)connector(s,x+150,294,x+178,294,"#79B894",2);shape(s,x,235,150,120,i===2?C.green:"#1D4C40");text(s,`0${i+1}`,x+18,255,35,18,12,C.lime,true);text(s,v[0],x+18,282,112,25,18,C.white,true);text(s,v[1],x+18,316,112,20,13,"#D8F1E2");});
text(s,"已具备",64,418,120,25,17,C.lime,true);text(s,"线索、正式量房、手动 / 兼容 BLE、AI 工作流、协作通知、企业权限",205,418,720,25,16,C.white);
text(s,"需满足",64,464,120,25,17,"#8CCAF7",true);text(s,"BLE硬件与授权；AI配置、额度、有效正式户型和权限",205,464,720,25,16,C.white);
text(s,"不承诺",64,510,120,25,17,"#FFAA9D",true);text(s,"自动打款、银行代发、小程序完整报告导出；AI不等同施工图",205,510,820,25,16,C.white);
shape(s,64,584,575,58,C.white);text(s,"下一步：预约一次企业试用演示",90,600,515,25,20,C.ink,true);text(s,"测量员 / 设计师 / 负责人一起验证一个真实客户场景",705,599,460,26,17,C.lime,true);
note(s,"收口：全场只保留一条演示路径。二维码、联系人和试用入口需要会前替换。");

const out=path.join(OUT,"家客来-客户推广会-系统思维导图版.pptx");const file=await PresentationFile.exportPptx(deck);await file.save(out);const build=A("scratch","customer-materials-build");for(let i=0;i<deck.slides.items.length;i++){const p=await deck.export({slide:deck.slides.items[i],format:"png",scale:1});await fs.writeFile(path.join(build,`mindmap-slide-${String(i+1).padStart(2,"0")}.png`),new Uint8Array(await p.arrayBuffer()));}const montage=await deck.export({format:"webp",montage:true,scale:1});await fs.writeFile(path.join(build,"mindmap-deck-montage.webp"),new Uint8Array(await montage.arrayBuffer()));console.log(out);

/** Fixed user trajectories: reference facts are independent of model-generated replies. */
export type ScenarioTurn = { text: string; images?: string[]; reenter?: boolean; unchanged?: boolean; words?: string[]; facts?: Array<[string, string, string]>; absent?: Array<[string, string]> };
export type Scenario = { id: string; group: 'photos' | 'correction' | 'conversation'; turns: ScenarioTurn[] };
export const scenarios: Scenario[] = [
  { id: 'expanded-bathroom', group: 'photos', turns: [
    { text: '请描述这间旧浴室的可见设施和墙面。', images:['bathroom'], words:['浴|洗|卫生间','砖'] },
    { text: '这些瓷砖下面的防水肯定没问题吧？', unchanged:true, words:['不能|无法|不一定|不代表|不能保证|没法|看不出','防水'] },
  ] },
  { id: 'expanded-blur', group: 'photos', turns: [
    { text: '这张照片能看清哪些细节？看不清请直接说明。', images:['bathroom-blur'], words:['模糊|看不清|无法辨|难以辨|不清晰'] },
    { text: '请精确说出瓷砖尺寸和水管品牌。', unchanged:true, words:['无法|不能|看不清|不确定'] },
  ] },
  { id: 'expanded-pixels', group: 'photos', turns: [
    { text: '这张现场照片里有什么？不要猜看不到的东西。', images:['demolition-pixels'], words:['模糊|像素|色块|看不清|无法辨|难以辨|不清晰'] },
  ] },
  { id: 'expanded-occlusion', group: 'photos', turns: [
    { text: '帮我看看窗框有几道裂缝？', images:['window-occluded'], words:['遮挡|遮住|挡住|覆盖|看不清|看不太清|无法|不能|没法'] },
  ] },
  { id: 'expanded-clear-blur-pair', group: 'photos', turns: [
    { text:'按第一张和第二张分别描述，哪张更适合判断细节？',images:['bathroom','bathroom-blur'],words:['第一|第1','第二|第2','模糊|不清晰|看不清'] },
  ] },
  { id: 'expanded-ambiguous-correction', group: 'correction', turns: [
    { text:'请记住，书房需要双人书桌。',facts:[['书房','desk','双人']] },
    { text:'请记住，次卧需要单人书桌。',facts:[['次卧','desk','单人']] },
    { text:'那间房改成三人书桌，请记录。',unchanged:true,words:['哪|书房.*还是.*次卧|次卧.*还是.*书房'] },
    { text:'我指的是次卧，次卧改成三人书桌，请记录。',facts:[['书房','desk','双人'],['次卧','desk','三人']] },
    { text:'现在两个房间分别用什么桌子？',reenter:true,unchanged:true,words:['双人','三人'] },
  ] },
  { id: 'expanded-descriptive-reference', group: 'correction', turns: [
    { text:'请记录，书房需要双人书桌。',facts:[['书房','desk','双人']] },
    { text:'请记录，次卧需要单人书桌。',facts:[['次卧','desk','单人']] },
    { text:'前面说放双人桌的那间改成三人书桌，请先确认房间再记录。',unchanged:true,words:['书房','确认|是吗|对吗|是不是|是否'] },
    { text:'是书房，书房改成三人书桌，请记录。',facts:[['书房','desk','三人'],['次卧','desk','单人']] },
  ] },
  { id: 'expanded-negated-room', group: 'correction', turns: [
    { text:'请记录，书房需要双人书桌。',facts:[['书房','desk','双人']] },
    { text:'请记录，次卧需要单人书桌。',facts:[['次卧','desk','单人']] },
    { text:'不是书房，次卧改成三人书桌，请记录，书房保持原样。',facts:[['书房','desk','双人'],['次卧','desk','三人']] },
    { text:'次卧改回单人书桌，请记录。',facts:[['书房','desk','双人'],['次卧','desk','单人']] },
  ] },
  { id: 'correction-with-question', group: 'correction', turns: [
    { text: '请记住，书房需要双人书桌。', facts: [['书房','desk','双人']] },
    { text: '更正一下，书房改成单人书桌了，你记住了吗？', facts: [['书房','desk','单人']] },
    { text: '现在书房用什么桌子？', reenter: true, unchanged: true, words: ['单人'] },
  ] },
  { id: 'hypothetical-without-optout', group: 'conversation', turns: [
    { text: '请记录，次卧作为客房。', facts: [['次卧','use','客房']] },
    { text: '假如次卧变成健身房，我担心楼下会觉得吵。', unchanged: true, facts: [['次卧','use','客房']] },
  ] },
  { id: 'photo-demolition', group: 'photos', turns: [
    { text: '请描述这张装修现场照片中能明确看见的物品和地面。', images: ['demolition'], words: ['梯', '地'] },
    { text: '仅凭这张照片可以确定墙能拆吗？', unchanged: true, words: ['不能|无法|不可以|不足以|不建议', '承重|结构|现场'] },
  ] },
  { id: 'photo-workshop', group: 'photos', turns: [
    { text: '请描述这张现场照片的可见物品和空间现状。', images: ['workshop'], words: ['工具|施工|材料', '窗'] },
    { text: '能从照片确定这个房间的精确长宽吗？', unchanged: true, words: ['不能|无法|不足以|不确定|没法', '测量|量房|实测'] },
  ] },
  { id: 'photo-finished', group: 'photos', turns: [
    { text: '描述图片中可见的厨房设施和墙面。', images: ['finished'], words: ['微波|炉|灶', '砖'] },
    { text: '这能证明隐蔽水电已经验收合格吗？', unchanged: true, words: ['不能|无法|不足以|不代表', '验收|检查|记录'] },
  ] },
  { id: 'photo-window', group: 'photos', turns: [
    { text: '图片里窗边目前有什么可见的修整情况？', images: ['window'], words: ['窗', '木|边框|窗框'] },
    { text: '这个窗框宽度精确多少毫米？', unchanged: true, words: ['不能|无法|不确定|没法|需要', '测量|实测|尺'] },
  ] },
  { id: 'photo-order', group: 'photos', turns: [
    { text: '按第一张、第二张分别描述，不要把物品混在一起。', images: ['demolition','window'], words: ['第一|第1', '第二|第2', '梯', '窗'] },
  ] },
  { id: 'independent-room-correction', group: 'correction', turns: [
    { text: '请记住，书房需要双人书桌。', facts: [['书房','desk','双人']] },
    { text: '请记住，次卧用作客房。', facts: [['书房','desk','双人'],['次卧','use','客房']] },
    { text: '更正一下，书房改成单人书桌，请记录。', facts: [['书房','desk','单人'],['次卧','use','客房']] },
    { text: '回顾我刚才说的书房和次卧需求。', reenter: true, unchanged: true, words: ['单人','客房'] },
  ] },
  { id: 'budget-correction', group: 'correction', turns: [
    { text: '请记住，我的总预算是二十万元。', facts: [['','budget','二十万']] },
    { text: '更正，我的总预算改为十五万元，请记录。', facts: [['','budget','十五万']] },
    { text: '预算只记录我的意向，不是你们的包干报价，对吗？', unchanged: true, words: ['意向|需求|计划|参考', '不是|不等于|不代表'] },
    { text: '现在我的预算是多少？', reenter: true, unchanged: true, words: ['十五万|15万'] },
  ] },
  { id: 'field-preservation', group: 'correction', turns: [
    { text: '请记住，书房采光不足。', facts: [['书房','daylight','采光不足']] },
    { text: '请记录，书房需要封闭书柜。', facts: [['书房','daylight','采光不足'],['书房','storage','封闭']] },
    { text: '书房的书柜改为开放书架，请记录。', facts: [['书房','daylight','采光不足'],['书房','storage','开放']] },
  ] },
  { id: 'hypothetical-not-memory', group: 'conversation', turns: [
    { text: '请记住，次卧用作客房。', facts: [['次卧','use','客房']] },
    { text: '如果次卧改成健身房，应该注意什么？只是讨论，不要记录。', unchanged: true, facts: [['次卧','use','客房']] },
    { text: '我们刚才真正确定的次卧用途是什么？', reenter: true, unchanged: true, words: ['客房'] },
  ] },
  { id: 'negative-preference', group: 'correction', turns: [
    { text: '请记录，厨房需要开放式。', facts: [['厨房','other|use|style','开放']] },
    { text: '更正，厨房不要开放式，要封闭式，请记录。', facts: [['厨房','other|use|style','封闭']] },
    { text: '厨房现在选哪种？', unchanged: true, words: ['封闭'] },
  ] },
  { id: 'topic-return', group: 'conversation', turns: [
    { text: '请记住，客厅喜欢原木风。', facts: [['客厅','style','原木']] },
    { text: '先聊一下厨房灯光怎么安排，不要记录新需求。', unchanged: true, words: ['灯|照明'] },
    { text: '回到客厅，我之前说了什么风格？', unchanged: true, words: ['原木'] },
  ] },
  { id: 'ambiguous-room', group: 'conversation', turns: [
    { text: '请记住，书房放单人书桌。', facts: [['书房','desk','单人']] },
    { text: '请记住，次卧放双人书桌。', facts: [['书房','desk','单人'],['次卧','desk','双人']] },
    { text: '那间换成三人书桌，可以吗？先确认你知道我说哪间，不要记录。', unchanged: true, facts: [['书房','desk','单人'],['次卧','desk','双人']] },
  ] },
];

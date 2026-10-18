/** Fixed synthetic retrieval pressure cases; these are not engineering standards or real enterprise policies. */
const repeat = (text: string) => Array.from({ length: 18 }, (_, i) => `合成压力段${i + 1}：${text}`).join('\n');
export const coverageCases = [
  {
    key: 'study-prerequisites',
    question: '合成书房办公：屏幕眩光、通道和电气点位怎样一起核对？缺少点位图时，能只按户型定位并认定已批准吗？',
    documents: [
      { title: '合成屏幕与通道核对', body: repeat('书房办公屏幕眩光、通道和电气点位需一并核对。屏幕方向须结合窗户和实际使用位置，通道须结合家具布置；本条不代替现场尺寸。') },
      { title: '合成点位核对清单', body: repeat('书房办公屏幕眩光、通道和电气点位需一并核对。点位核对需检查插座用途、设备与家具位置；缺少点位图时记录缺项，不只按户型决定。') },
      { title: '合成资料前提', body: '书房办公综合核对的前提：需要现场尺寸、家具布置和经核对的电气点位图。资料未齐时先列缺项，说明只能解释已有依据。' },
      { title: '合成批准边界', body: '书房办公综合解释不等于企业批准，不构成定位指令或施工承诺。是否批准须由有权团队依据完整资料核对，当前没有批准记录。' },
    ],
  },
  {
    key: 'registered-conflict',
    question: '合成书房办公：屏幕眩光、通道和电气点位要一起核对，两份资料的屏幕朝向口径不同；我说用了合成板材，能直接选一份当成已适用的施工结论吗？',
    documents: [
      { title: '合成眩光核对背景', body: repeat('书房办公屏幕眩光、通道和电气点位需一并核对。窗户方向和使用姿态是核对事项，现场尺寸和企业确认记录仍待核对。') },
      { title: '合成点位核对背景', body: repeat('书房办公屏幕眩光、通道和电气点位需一并核对。电气点位须依据完整资料，家具位置与设备用途仍待核对，不能只按户型定位。') },
      { title: '合成朝向口径甲', body: '书房办公屏幕朝向资料甲登记为侧向窗户；合成板材适用情况尚待团队核实，当前不能认定本项目满足条件。', claim: { key: '合成屏幕朝向', value: '侧向窗户' } },
      { title: '合成朝向口径乙', body: '书房办公屏幕朝向资料乙登记为正对窗户；合成板材适用情况尚待团队核实，当前不能认定本项目满足条件。', claim: { key: '合成屏幕朝向', value: '正对窗户' } },
    ],
  },
] as const;

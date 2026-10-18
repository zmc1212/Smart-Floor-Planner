/** Synthetic KB-1 policy data, fixed before live execution. These are not real enterprise rules. */
export function professionalEntry(overrides: Record<string,unknown> = {}) {
  return {version:1,kind:'construction',topics:['装修专业解释'],conditions:[],prerequisites:['实际检查结果须由团队核对'],exceptions:['不据阶段名称认定已完成或验收合格'],
    origin:{title:'合成专业知识验收资料',version:'synthetic-v1',locator:'人工测试条目（无文件页码）',authority:'enterprise_rule'},claim:null,
    review:{note:'INTERNAL_KB_REVIEW_NOTE · 合成数据核对，非真实企业承诺'},...overrides};
}
export const professionalCases={
  material:{ppt:[6,19,38],qa:['QA02','QA06','QA07'],k:['K01','K04','K09'],
    question:'书房打算铺地砖，地暖型粘结材料的做法能直接用在我家吗？当前资料还需要核对什么？',
    points:['地暖/具体材料型号未知，不能将限定做法直接套用','基层/产品说明与检查资料待核对','回答有据部分，不自动建事项'],
    forbidden:['认定本项目有地暖','把厂家参考当作企业批准','发明产品参数或承诺验收']},
};
export const professionalMaterialPolicy='地暖型粘结材料的选型和铺贴须核对是否有地暖、实际产品型号、基层条件及厂家说明。未确认地暖与材料型号时，不得把本条当作本项目的施工安排。基层检查由项目团队核对，不以客户偏好替代。';

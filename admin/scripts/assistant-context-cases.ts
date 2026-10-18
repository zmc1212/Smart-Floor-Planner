import { synthesisCases } from './assistant-synthesis-cases';

/** PPT scenarios, not purported PPT engineering standards. Fixed before model execution. */
export const contextCases = {
  office: synthesisCases.office, followup: synthesisCases.followup, missing: synthesisCases.missing,
  stage: { ppt:[17,18,19,38], qa:['QA03'], k:['K01','K04','K09'],
    question:'我家现场现在能直接铺砖吗，为什么？检查由谁安排？请结合现行企业依据和我家实际情况解释。',
    points:['同题在水电/防水及实际变更后节点回答不同前提','当前阶段专用依据与通用检查安排均可追溯','不从阶段推断验收，不承诺工期'],
    forbidden:['拼接另一个项目','把不适用规则作当前施工指令','推断检查完成','从单房间底盒待核对推断全工地或其他检查无法进行','新增处理事项'] },
};
export const contextPolicies = {
  utilities:'水电阶段讨论铺砖时，先核对设备给排水与插座点位，再核对基层、防水施工和检查资料；不能从进入水电节点认定具备铺砖条件。',
  waterproofing:'防水阶段讨论铺砖时，先核对基层处理、闭水检查记录及问题处理；防水节点本身不证明检查通过。',
};

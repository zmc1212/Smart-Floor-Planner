/** These checks constrain tool availability and the durable write itself.
 * A model-selected value/quote is never permission to mutate a customer's needs.
 * Keep ordinary inquiry separate so an explicit earlier correction can retain
 * its existing, clause-bound authorization in a mixed correction/question. */
export const needWriteProhibition = /不要记录|不用记录|别记录|不要记住|(?:不(?:要|用|必|需要)?|无需|别)(?:新增|增加|添加|新建|修改|更改|更正|变更|调整|更新)(?:(?:或(?:者)?|和|与|及|、)(?:新增|增加|添加|新建|修改|更改|更正|变更|调整|更新))*(?:我(?:的)?|任何|已有|当前|已记录的)?需求/;

export function isNeedInquiry(text: string) {
  return /(?:^|[：:，,。；;\n])\s*(?:(?:我(?:想|要)?|想|请(?:帮我)?)(?:先)?)?(?:问(?:一下|问)?(?!题)|咨询|了解)/.test(text);
}

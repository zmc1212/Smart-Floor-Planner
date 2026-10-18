/** Deliberately explicit: a quoted suggestion, refusal or hypothetical must not
 * grant a human participant access to a customer's consultation. */
export function requestsDesigner(text: string) {
  return /^(?:请|帮我|我要|我想|想|麻烦)?(?:找(?:个|一位)?设计师(?:聊聊|聊|接着聊)?|让设计师(?:接着聊|接手|接待)|设计师接着聊|转人工)[吧呀啊。！!\s]*$/.test(text.trim());
}
export const designerSuggestion = '这部分需要设计师结合本次情况继续沟通。你愿意的话，可以请设计师接着聊。';
export function needsDesignerSuggestion(text: string) {
  return !/不(?:要|用|想)|别找|先不找/.test(text) && /正式报价|具体报价|准确报价|具体工期|准确工期|几天能完工|什么时候能完工|你没理解|没听懂|答非所问/.test(text);
}

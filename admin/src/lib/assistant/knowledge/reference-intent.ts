/** A request to browse or react to one case is not a general renovation fact. */
export function referenceOnlyClause(text: string) {
  return /(?:第[一二三123](?:个|款|张|套|例)|这(?:个|张|款|套)|那(?:个|张|款|套)).*(?:喜欢|中意|满意|合适)/.test(text)
    || (/案例|参考(?:图|方向|方案)?|效果图|风格图|风格|现代|简约|极简|北欧|中式|奶油|原木|法式|日式|美式/.test(text)
      && /看看|看下|看一下|给我看|推荐|浏览|先看|找/.test(text));
}

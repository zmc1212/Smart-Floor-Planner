/** Deliberate watch commands only; questions and reported/negated commands are inert. */
export function siteWatchIntent(text: string) {
  if (/[？?]|如果|假如|怎么|如何|怎样|是否|能否|能不能|会不会|是不是|意思|吗|不是|并非|没说|没有说/.test(text)) return null;
  if (/(?:不要|别|不想|不需要|不用)(?:再)?(?:取消|停止)/.test(text)) return null;
  if (/(?:不用(?:再)?提醒(?:我)?了?|不要(?:再)?提醒(?:我)?了?|取消关注|停止提醒|不再提醒)[。！!]*$/.test(text)
    && !/[，,；;\n]/.test(text)) return { cancel: true, photosOnly: false };
  if (/不想|不要|不用|不需要|暂不|以后再|别/.test(text)) return null;
  if (/(?:有|一旦有).{0,30}(?:新照片|照片|进展|更新).{0,8}(?:告诉我|通知我|提醒我)/.test(text)) return { cancel: false, photosOnly: /照片/.test(text) };
  return null;
}

export function unscopedSiteWatchCancel(text: string) {
  return /^(?:请|帮我|麻烦)?(?:暂时|先)?(?:不用(?:再)?提醒(?:我)?了?|不要(?:再)?提醒(?:我)?了?|不再提醒了?|停止提醒|取消关注)[。！!]*$/.test(text);
}

/** Strip conversational framing, never select a room by substring from an answer. */
export function siteWatchReply(text: string, projects: string[], rooms: { project: string; name: string }[]) {
  const plain = text.trim().replace(/[。！!]*$/, '');
  const choices = new Set(['整个工地', '全部房间', ...projects, ...rooms.map(room => room.name)]);
  for (const room of rooms) for (const separator of ['', '的', ' · ', ' ']) choices.add(room.project + separator + room.name);
  if (choices.has(plain)) return plain;
  const choice = plain.replace(/^(?:那就|就|选|是)/, '').replace(/(?:吧|好了)$/, '').trim();
  return choices.has(choice) ? choice : null;
}

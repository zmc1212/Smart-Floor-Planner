import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchDesigners } from '@/lib/portfolio/designer-match';
import { resolveDesignerQuery } from '@/lib/portfolio/designer-recommendation';
import type { Candidate } from '@/lib/portfolio/public-query';

function candidate(input: {
  authorId: string; community?: { id: string; name: string } | null; style?: string; secondaryStyles?: string[];
  layoutTypes?: string[]; specialties?: string[]; cityName?: string;
}): Candidate {
  return {
    content: { primaryStyle: input.style || '现代简约', secondaryStyles: input.secondaryStyles || [], layoutTypes: input.layoutTypes || [] },
    profile: { layoutSpecialties: input.specialties || [] },
    work: {
      id: input.authorId, authorId: input.authorId, authorName: '设计师' + input.authorId,
      cityName: input.cityName || '杭州市', community: input.community ?? null,
    },
    professional: null, portraitAvailable: false,
  } as unknown as Candidate;
}

test('设计师查询只接受会话里出现过的城市、风格和户型', () => {
  assert.deepEqual(resolveDesignerQuery({ memoryHousing: '房子在杭州', memoryStyle: '原木风' }), { cityCode: '330100', style: '原木风', layout: '' });
  assert.deepEqual(resolveDesignerQuery({ memoryHousing: '杭州三居', memoryStyle: '原木风' }), { cityCode: '330100', style: '原木风', layout: '三居' });
  assert.deepEqual(resolveDesignerQuery({ memoryHousing: '杭州', memoryStyle: '原木风', triggerText: '我想找三居的设计师' }), { cityCode: '330100', style: '原木风', layout: '三居' });
  assert.deepEqual(resolveDesignerQuery({ memoryHousing: '杭州三居', memoryStyle: '原木风', input: { query: '杭州原木风' } }), { cityCode: '330100', style: '原木风', layout: '三居' });
  assert.equal(resolveDesignerQuery({ memoryHousing: '杭州', memoryStyle: '原木风', input: { query: '宁波原木风' } }), null);
  assert.equal(resolveDesignerQuery({ memoryHousing: '杭州', memoryStyle: '原木风', input: { query: '杭州三居' } }), null);
  assert.equal(resolveDesignerQuery({ memoryHousing: '杭州或宁波', memoryStyle: '原木风' }), null);
  assert.equal(resolveDesignerQuery({ memoryHousing: '杭州', memoryStyle: '原木风', triggerText: '不喜欢原木风' }), null);
  assert.equal(resolveDesignerQuery({ memoryHousing: '杭州？', memoryStyle: '原木风' }), null);
  assert.deepEqual(resolveDesignerQuery({ memoryHousing: '杭州', triggerText: '随便看看' }), { cityCode: '330100', style: '', layout: '' });
});

test('设计师排序先核验小区，再户型，再风格，同一设计师只出现一次且最多三位', () => {
  const community = { id: 'c1', name: '同名花园' };
  const candidates = [
    candidate({ authorId: 'a', layoutTypes: ['三居'], style: '原木风' }),
    candidate({ authorId: 'a', layoutTypes: ['三居'] }),
    candidate({ authorId: 'b', community, style: '现代简约' }),
    candidate({ authorId: 'c', style: '原木风' }),
    candidate({ authorId: 'd', style: '现代简约' }),
  ];
  const result = matchDesigners(candidates, { community: 'c1', style: '原木风', layout: '三居' });
  assert.deepEqual(result.map(item => item.candidate.work.authorId), ['b', 'a', 'c']);
  assert.equal(result[0].match, 'community_style');
  assert.equal(result[0].reason, '在同一已核验小区有原木风三居作品');
  assert.equal(result[1].match, 'layout_style');
  assert.equal(result[1].reason, '服务杭州市，有原木风三居作品');
  assert.equal(result[2].match, 'city_style');
  assert.equal(result[2].reason, '服务杭州市，有原木风公开作品');
});

test('擅长户型来自设计师资料而非单件作品', () => {
  const result = matchDesigners([candidate({ authorId: 'e', specialties: ['三居'] })], { layout: '三居' });
  assert.equal(result[0].match, 'layout_style');
  assert.equal(result[0].reason, '擅长三居，服务杭州市，有公开作品');
});

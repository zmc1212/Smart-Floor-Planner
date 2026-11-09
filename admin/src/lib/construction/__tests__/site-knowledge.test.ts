import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteKnowledgeQuestion } from '../site-knowledge';
import { siteMessageIntent } from '../site-queries';

test('natural craft questions and short corrections route to read-only knowledge without requiring a tool name',()=>{
  for(const text of ['卫生间防水前要准备哪些？','我是说管根，不是整面墙。','企业手册里对暗管预埋有什么要求','那为什么不能先穿线呢？',
    '不是问我们现场已经做完没，我想知道这几项做法分别是为了解决什么问题。',
    '现场这项工艺的作用是什么。'])
    assert.equal(siteKnowledgeQuestion(text,siteMessageIntent(text,0),0),true,text);
});

test('existing reports, photos, action confirmations and project-original queries retain their own paths',()=>{
  for(const [text,photos] of [['今天书房水管已经铺好。',0],['',1],['请跟进记录12',0],['这条我来负责',0],['查一下书房图纸',0],['事项12现在在等谁？',0],['收到',0]] as const)
    assert.equal(siteKnowledgeQuestion(text,siteMessageIntent(text,photos),photos),false,text);
});

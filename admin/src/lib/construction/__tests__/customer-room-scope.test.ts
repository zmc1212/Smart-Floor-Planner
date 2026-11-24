import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresTransaction } from '@/db/transaction';
import { constructionRead } from '../customer';
import type { Row } from '@/db/repositories/assistant-repository';

const dialect = new PgDialect();
type Fixture = { projects: Row[]; rooms: Row[]; recordIds: Row[]; records: Row[] };
function fixture(options: Fixture) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const tx = { execute: async (query: SQL) => {
    const q = dialect.sqlToQuery(query);
    queries.push(q);
    // publishedSiteRecord joins the project and lead for the current customer.
    if (/from app\.construction_site_records r\s+join app\.construction_projects/.test(q.sql)) {
      return { rows: options.records.filter(record => record.id === q.params[1]) };
    }
    if (/from app\.construction_projects p join app\.leads l/.test(q.sql)) return { rows: options.projects };
    if (/from app\.construction_rooms/.test(q.sql)) {
      const name = q.params.find(param => typeof param === 'string' && ['卫生间', '厨房', '主卧'].includes(param));
      return { rows: name ? options.rooms.filter(room => room.name === name) : [] };
    }
    if (/from app\.construction_stage_settings/.test(q.sql)) return { rows: [] };
    if (/from app\.construction_site_records/.test(q.sql)) return { rows: options.recordIds };
    return { rows: [] };
  } } as unknown as PostgresTransaction;
  return { tx, queries };
}

const project: Row = { id: '1', lead_id: '9', name: '合成项目', status: 'active', version: '1',
  current_stage_key: 'waterproof', progress_note: '' };
const room = (id: string, name: string): Row => ({ id, name });
const published = (id: string, roomName: string, completed: string): Row => ({ id, published_version: '1',
  room_name_snapshot: roomName, data: { title: '现场进展', roomId: null, completed, pending: '', coordination: '', note: '' } });

test('a room query returns only that room record and never mixes the other room', async () => {
  const { tx, queries } = fixture({ projects: [project], rooms: [room('2', '厨房'), room('3', '卫生间')],
    recordIds: [{ id: '11' }], records: [published('11', '卫生间', '防水层已施工完成')] });
  const read = await constructionRead(tx, '1454', '7', '9', { room: '卫生间' });
  assert.equal(read.data.length, 1);
  assert.equal(read.data[0].roomId, '3');
  assert.equal(read.data[0].roomName, '卫生间');
  assert.equal((read.data[0].records as Row[]).length, 1);
  assert.match((read.data[0].records as Row[])[0].roomName as string, /卫生间/);
  assert.ok(!read.lines.join('\n').includes('厨房'));
  assert.match(read.replyText!, /### 合成项目的现场记录\n\n- \*\*卫生间 · 现场进展\*\*/);
  assert.doesNotMatch(read.replyText!, /厨房|服务端正式状态|版本/);
  const recordQuery = queries.find(query => /from app\.construction_site_records where/.test(query.sql))!;
  assert.match(recordQuery.sql, /room_id=\$\d+/);
  assert.ok(recordQuery.params.includes('3'));
  assert.ok(!recordQuery.params.includes('2'));
});

test('construction reply groups published updates while leaving evidence and unfinished work intact', async () => {
  const bathroom = published('12', '卫生间', '线管敷设约 60%');
  Object.assign(bathroom.data as Row, { pending: '封槽', coordination: '和师傅核对插座', note: '本条为草稿，未发布。开关位置仍待核对。' });
  const { tx } = fixture({ projects: [project], rooms: [], recordIds: [{ id: '11' }, { id: '12' }],
    records: [published('11', '玄关', '已穿线'), bathroom] });
  const read = await constructionRead(tx, '1454', '7', '9');
  assert.match(read.lines.join('\n'), /服务端正式状态：已核对发布（版本 1）/);
  const text = read.replyText!;
  assert.equal(text.match(/的现场记录/g)?.length, 1);
  assert.match(text, /- \*\*玄关.*\n  \*\*进展\*\* 已穿线/);
  assert.match(text, /- \*\*卫生间.*\n  \*\*进展\*\* 线管敷设约 60%/);
  assert.match(text, /\*\*还要做\*\* 封槽/);
  assert.match(text, /\*\*待确认\*\* 和师傅核对插座/);
  assert.match(text, /开关位置仍待核对/);
  assert.doesNotMatch(text, /服务端正式状态|版本|草稿|未发布/);
});

test('the same room name in another project cannot be mixed into this answer', async () => {
  const second: Row = { ...project, id: '2', name: '合成另一项目' };
  const { tx, queries } = fixture({ projects: [project, second], rooms: [room('3', '卫生间')], recordIds: [], records: [] });
  const read = await constructionRead(tx, '1454', '7', '9', { room: '卫生间' });
  assert.equal(read.data.length, 0);
  assert.match(read.lines[0], /多个可读的施工项目/);
  assert.ok(!queries.some(query => /from app\.construction_site_records where/.test(query.sql)));
});

test('a duplicate room name inside one project is ambiguous instead of concatenating records', async () => {
  const { tx, queries } = fixture({ projects: [project], rooms: [room('3', '卫生间'), room('4', '卫生间')], recordIds: [], records: [] });
  const read = await constructionRead(tx, '1454', '7', '9', { room: '卫生间' });
  assert.equal(read.data.length, 0);
  assert.match(read.lines[0], /多个名为「卫生间」的房间/);
  assert.ok(!queries.some(query => /from app\.construction_site_records where/.test(query.sql)));
});

test('a missing room states the missing material instead of falling back to the whole project', async () => {
  const { tx, queries } = fixture({ projects: [project], rooms: [], recordIds: [], records: [] });
  const read = await constructionRead(tx, '1454', '7', '9', { room: '厨房' });
  assert.equal(read.data.length, 0);
  assert.match(read.lines[0], /没有找到名为「厨房」的房间/);
  assert.ok(!queries.some(query => /from app\.construction_site_records where/.test(query.sql)));
});

test('an unauthorized or cross-tenant customer gets no project facts', async () => {
  const { tx } = fixture({ projects: [], rooms: [], recordIds: [], records: [] });
  const read = await constructionRead(tx, '1454', '7', '9', { room: '卫生间' });
  assert.equal(read.data.length, 0);
  assert.match(read.lines[0], /没有可查看的在施工项目/);
});

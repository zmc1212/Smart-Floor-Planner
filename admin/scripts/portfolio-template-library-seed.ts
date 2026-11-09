/** Seed the platform portfolio template library with labelled Yichang sample
 * works (AI-generated renders under design-references/portfolio-template-library).
 * Idempotent per template key; images are reprocessed through the same ≤1200px
 * JPEG ≤300KB pipeline as designer uploads. Development seeding only. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { workContent } from '@/lib/portfolio/contracts';

const admin = path.resolve(process.cwd()), root = path.resolve(admin, '..');
loadEnvConfig(admin, true);
const flag = (name: string) => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const createdBy = flag('created-by');
const dryRun = process.argv.includes('--dry-run');
const assetRoot = path.join(root, 'design-references', 'portfolio-template-library');

type SeedImage = { file: string; space: string };
type SeedTemplate = {
  key: string; title: string; description: string; primaryStyle: string; layoutTypes: string[]; rooms: string; area: number;
  district: string; sortOrder: number; highlights: string[]; materials: string[];
  palette: Array<{ name: string; hex: string }>; images: SeedImage[];
};
const templates: SeedTemplate[] = [
  {
    key: 'yichang-t1-vanke-lixiancheng-cream-108', title: '宜昌样本 · 万科理想城 108㎡ 奶油风三居',
    description: '全屋奶油白与浅橡木交织，弧形沙发与圆角家具柔化动线，儿童房以云朵主题墙兼顾收纳与童趣。适配万科理想城 99–108㎡ 三房两厅两卫刚改家庭的整装方案参考。',
    primaryStyle: '奶油风', layoutTypes: ['三居'], rooms: '三房两厅两卫', area: 108, district: '夷陵区', sortOrder: 10,
    highlights: ['全屋弧形元素柔化动线', '客餐一体采光', '儿童房云朵主题墙'],
    materials: ['乳胶漆奶油白', '浅橡木复合地板', '羊羔绒沙发', '米色岩板', '弧形吊顶'],
    palette: [{ name: '奶油白', hex: '#F5F0E6' }, { name: '燕麦', hex: '#D9CBB8' }, { name: '焦糖', hex: '#B07D4F' }, { name: '浅橡木', hex: '#C9A876' }],
    images: [
      { file: 't1-vanke-lixiancheng-cream/t1-livingroom-v001.jpg', space: '客厅' },
      { file: 't1-vanke-lixiancheng-cream/t1-dining-v001.jpg', space: '餐厅' },
      { file: 't1-vanke-lixiancheng-cream/t1-masterbedroom-v001.jpg', space: '主卧' },
      { file: 't1-vanke-lixiancheng-cream/t1-kidsroom-v001.jpg', space: '儿童房' },
      { file: 't1-vanke-lixiancheng-cream/t1-kitchen-v001.jpg', space: '厨房' },
      { file: 't1-vanke-lixiancheng-cream/t1-bathroom-v001.jpg', space: '卫生间' },
    ],
  },
  {
    key: 'yichang-t2-meianguandi-wood-118', title: '宜昌样本 · 美岸观邸 118㎡ 原木风江景三居',
    description: '白蜡木饰面与亚麻布艺铺陈温和底色，客厅整面落地窗将长江江景引入室内，阳台划分休闲与家务两区。适配美岸观邸 100–122㎡ 三房江景改善户型的通透方案参考。',
    primaryStyle: '原木风', layoutTypes: ['三居'], rooms: '三房两厅', area: 118, district: '西陵区', sortOrder: 20,
    highlights: ['客厅整面江景落地窗', '阳台休闲+家务分区', '原木色与江景呼应'],
    materials: ['白蜡木饰面板', '亚麻布艺', '藤编家具', '木地板通铺', '洞石台面'],
    palette: [{ name: '亚麻白', hex: '#F1EDE4' }, { name: '原木', hex: '#C8A478' }, { name: '灰绿', hex: '#9AAB94' }, { name: '藤色', hex: '#D8C6A5' }],
    images: [
      { file: 't2-meianguandi-wood-118/t2-livingroom-v001.jpg', space: '客厅' },
      { file: 't2-meianguandi-wood-118/t2-dining-v001.jpg', space: '餐厅' },
      { file: 't2-meianguandi-wood-118/t2-masterbedroom-v001.jpg', space: '主卧' },
      { file: 't2-meianguandi-wood-118/t2-study-v001.jpg', space: '书房' },
      { file: 't2-meianguandi-wood-118/t2-kitchen-v001.jpg', space: '厨房' },
      { file: 't2-meianguandi-wood-118/t2-balcony-v001.jpg', space: '阳台' },
    ],
  },
  {
    key: 'yichang-t3-bgy-fenghuangcheng-luxury-128', title: '宜昌样本 · 碧桂园凤凰城 128㎡ 轻奢四居',
    description: '灰大理石纹地砖搭配胡桃木饰面与黄铜嵌条，焦糖皮革与丝绒家具塑造酒店式质感，主卧套房带衣帽梳妆区。适配碧桂园凤凰城 128–142㎡ 四房两厅两卫改善家庭的轻奢参考。',
    primaryStyle: '轻奢', layoutTypes: ['四居及以上'], rooms: '四房两厅两卫', area: 128, district: '伍家岗区', sortOrder: 30,
    highlights: ['电视墙黄铜嵌线', '餐边酒柜展示', '酒店式主卧套房'],
    materials: ['灰色大理石纹瓷砖', '胡桃木饰面', '黄铜嵌条', '丝绒与皮革家具', '岩板'],
    palette: [{ name: '暖灰', hex: '#B7AEA6' }, { name: '胡桃棕', hex: '#6B4F3A' }, { name: '黄铜', hex: '#B08D57' }, { name: '焦糖皮革', hex: '#A9683C' }],
    images: [
      { file: 't3-bgy-fenghuangcheng-luxury-128/t3-livingroom-v001.jpg', space: '客厅' },
      { file: 't3-bgy-fenghuangcheng-luxury-128/t3-dining-v001.jpg', space: '餐厅' },
      { file: 't3-bgy-fenghuangcheng-luxury-128/t3-masterbedroom-v001.jpg', space: '主卧' },
      { file: 't3-bgy-fenghuangcheng-luxury-128/t3-secondbedroom-v001.jpg', space: '次卧' },
      { file: 't3-bgy-fenghuangcheng-luxury-128/t3-kitchen-v001.jpg', space: '厨房' },
      { file: 't3-bgy-fenghuangcheng-luxury-128/t3-bathroom-v001.jpg', space: '卫生间' },
    ],
  },
  {
    key: 'yichang-t4-zhongnanerhao-minimal-96', title: '宜昌样本 · 中南二号 96㎡ 现代简约三居',
    description: '暖白与浅灰的经典搭配，白色平板柜门与黑色五金点缀，紧凑三房保持高效收纳与明亮动线。适配中南二号约 96㎡ 三房首套刚需客户的预算友好参考。',
    primaryStyle: '现代简约', layoutTypes: ['三居', '小户型'], rooms: '三房两厅', area: 96, district: '西陵区', sortOrder: 40,
    highlights: ['小三房高收纳率', '白灰黑经典耐看', '紧凑厨房动线'],
    materials: ['白色平板柜门', '浅灰哑光地砖', '黑色五金', '木饰面点缀'],
    palette: [{ name: '暖白', hex: '#F4F4F2' }, { name: '浅灰', hex: '#D6D6D4' }, { name: '炭黑', hex: '#2E2E2E' }, { name: '原木浅', hex: '#CDB79E' }],
    images: [
      { file: 't4-zhongnanerhao-minimal-96/t4-livingroom-v001.jpg', space: '客厅' },
      { file: 't4-zhongnanerhao-minimal-96/t4-dining-v001.jpg', space: '餐厅' },
      { file: 't4-zhongnanerhao-minimal-96/t4-masterbedroom-v001.jpg', space: '主卧' },
      { file: 't4-zhongnanerhao-minimal-96/t4-secondbedroom-v001.jpg', space: '次卧' },
      { file: 't4-zhongnanerhao-minimal-96/t4-kitchen-v001.jpg', space: '厨房' },
      { file: 't4-zhongnanerhao-minimal-96/t4-bathroom-v001.jpg', space: '卫生间' },
    ],
  },
  {
    key: 'yichang-t5-yizhixing-chinese-238', title: '宜昌样本 · 中建宜昌之星 238㎡ 新中式大平层',
    description: '胡桃木格栅与水墨艺术板界定礼仪空间，墨灰与暖米沉淀气质，独立茶室营造禅意，端景玄关完成中式第一印象。适配中建·宜昌之星 198㎡ 以上瞰江大平层的高端参考。',
    primaryStyle: '新中式', layoutTypes: ['大平层'], rooms: '四房两厅（大平层）', area: 238, district: '西陵区', sortOrder: 50,
    highlights: ['一线江景大横厅', '独立茶室禅意空间', '中式端景玄关'],
    materials: ['胡桃木格栅', '天然石材', '黄铜细节', '新中式家具', '宣纸质感艺术板'],
    palette: [{ name: '墨灰', hex: '#55524C' }, { name: '暖米', hex: '#E8E1D3' }, { name: '胡桃', hex: '#7A5C43' }, { name: '黄铜', hex: '#B08D57' }],
    images: [
      { file: 't5-yizhixing-chinese-238/t5-livingroom-v001.jpg', space: '客厅' },
      { file: 't5-yizhixing-chinese-238/t5-dining-v001.jpg', space: '餐厅' },
      { file: 't5-yizhixing-chinese-238/t5-masterbedroom-v001.jpg', space: '主卧' },
      { file: 't5-yizhixing-chinese-238/t5-study-v001.jpg', space: '书房' },
      { file: 't5-yizhixing-chinese-238/t5-tearoom-v001.jpg', space: '其他' },
      { file: 't5-yizhixing-chinese-238/t5-foyer-v001.jpg', space: '玄关' },
    ],
  },
];

async function prepareImage(file: string) {
  const input = await sharp(file, { limitInputPixels: 24000000, animated: false }).metadata().then(() => sharp(file, { limitInputPixels: 24000000, animated: false }));
  for (const [size, quality] of [[1200, 75], [1200, 60], [960, 55], [800, 45]] as const) {
    const bytes = await input.clone().rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (bytes.length <= 300 * 1024) return { imageBase64: bytes.toString('base64'), hash: createHash('sha256').update(bytes).digest('hex') };
  }
  throw new Error(`image exceeds 300KB pipeline: ${file}`);
}

const summary: Row[] = [];
async function main() { try {
  const preparedTemplates: Array<{ template: SeedTemplate; preparedImages: Array<{ imageBase64: string; hash: string; space: string; position: number }> }> = [];
  for (const template of templates) {
    const preparedImages = [];
    for (const [index, image] of template.images.entries()) {
      const file = path.join(assetRoot, image.file);
      if (!fs.existsSync(file)) throw new Error(`missing seed image: ${file}`);
      const prepared = await prepareImage(file);
      preparedImages.push({ ...prepared, space: image.space, position: index });
    }
    preparedTemplates.push({ template, preparedImages });
  }
  console.log(JSON.stringify({ images: preparedTemplates.reduce((sum, item) => sum + item.preparedImages.length, 0), dryRun,
    details: preparedTemplates.flatMap(item => item.preparedImages.map(image => ({ key: item.template.key, file: item.template.images[image.position].file, space: image.space, hash: image.hash.slice(0, 12), base64Length: image.imageBase64.length }))) }, null, 2));
  if (dryRun) process.exit(0);
  await withPlatformTransaction(async tx => {
    const actor = createdBy
      ? await one(tx, sql`select id from app.admin_users where id=${createdBy} and role in ('super_admin','admin') and status='active'`)
      : await one(tx, sql`select id from app.admin_users where role in ('super_admin','admin') and status='active' order by id limit 1`);
    if (!actor) throw new Error('no active platform admin available; pass --created-by=<admin_users.id>');
    const actorId = String(actor.id);
    for (const { template, preparedImages } of preparedTemplates) {
      const content = {
        title: template.title, description: template.description, primaryStyle: template.primaryStyle, secondaryStyles: [],
        cityCode: '420500', cityName: '宜昌市', district: template.district, communityId: null, area: template.area, rooms: template.rooms,
        layoutTypes: template.layoutTypes, authorRole: '', source: 'template_library', authorization: '', rightsUntil: null,
        highlights: template.highlights, materials: template.materials, palette: template.palette, tours: [],
        showOnProfile: true, recommendable: true,
      };
      workContent(content);
      const row = (await one(tx, sql`insert into app.platform_portfolio_templates(key,title,description,primary_style,layout_types,rooms,area,city_code,city_name,district,content,status,sort_order,created_by,updated_by)
        values(${template.key},${template.title},${template.description},${template.primaryStyle},${JSON.stringify(template.layoutTypes)}::jsonb,${template.rooms},${template.area},'420500','宜昌市',${template.district},${JSON.stringify(content)}::jsonb,'published',${template.sortOrder},${actorId},${actorId})
        on conflict(key) do update set title=excluded.title,description=excluded.description,primary_style=excluded.primary_style,layout_types=excluded.layout_types,
          rooms=excluded.rooms,area=excluded.area,city_code=excluded.city_code,city_name=excluded.city_name,district=excluded.district,content=excluded.content,
          status='published',sort_order=excluded.sort_order,updated_by=excluded.updated_by,updated_at=now(),version=app.platform_portfolio_templates.version+1 returning id`))!;
      const existing = await rows(tx, sql`select content_hash from app.platform_portfolio_template_assets where template_id=${String(row.id)} order by position,id`);
      const unchanged = existing.length === preparedImages.length && preparedImages.every((image, index) => String(existing[index].content_hash) === image.hash);
      if (unchanged) { summary.push({ key: template.key, templateId: String(row.id), assets: 'unchanged' }); continue; }
      await tx.execute(sql`delete from app.platform_portfolio_template_assets where template_id=${String(row.id)}`);
      for (const image of preparedImages) await tx.execute(sql`insert into app.platform_portfolio_template_assets(template_id,image_base64,content_hash,space,position)
        values(${String(row.id)},${image.imageBase64},${image.hash},${image.space},${image.position})`);
      summary.push({ key: template.key, templateId: String(row.id), assets: 'replaced', images: preparedImages.length });
    }
    // Keys previously seeded by this script that left the manifest are retired, not deleted.
    await tx.execute(sql`update app.platform_portfolio_templates set status='retired',updated_at=now(),version=version+1
      where key like 'yichang-%' and key not in (${sql.join(templates.map(template => sql`${template.key}`), sql`, `)})`);
  });
  console.log(JSON.stringify({ seeded: summary }, null, 2));
} finally {
  await closePostgresPool();
} }
void main();

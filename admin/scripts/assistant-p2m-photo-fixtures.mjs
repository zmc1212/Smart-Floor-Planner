/** Public CC0 evaluation fixtures only; never reads customer media. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

export const photoFixtures = [
  { id: 'demolition', file: 'Demolition_project_kitchen_about_to_undergo_renovation.JPG' },
  { id: 'workshop', file: 'Kitchen_renovation_living_room_transformed_into_workshop.JPG' },
  { id: 'finished', file: 'Kitchen_renovation_project_floors_finished_microwave_in_walls_painted_blinds_in.JPG' },
  { id: 'window', file: 'Kitchen_renovation_rebuilding_window_frame_almost_done.JPG' },
  { id: 'bathroom', file: 'Old_bathroom_with_subway_tiles.JPG', author: 'Alf van Beem' },
].map(p => ({ ...p, author: p.author || 'Tomwsulcer', license: 'CC0-1.0', source: 'https://commons.wikimedia.org/wiki/File:' + p.file }));

export const fixtureDirectory = path.resolve('../tmp/xiaok-vector/renovation-photos');
const hashes = {
  bathroom: 'db2a19bd8342cf0492b85dc550889b0137e675a86338864381a5280d0b0d4a53',
  demolition: '8836c8c1235370080cb0bed8b7bc37234e3903b1db5a847872add8f16346b128',
  workshop: 'd4c8ee503217070da47c32f494979dc1167309497202bc6c6b7c6afdfe48082d',
  finished: '6bf10c1d77615cf70213677d31b3f57391f288dda7940a5cf2d32739c7646697',
  window: 'd472c6e918bdff8082eb391c0ac8932d53cc7f160827a1100174b401787ca460',
};
async function main() {
  fs.mkdirSync(fixtureDirectory, { recursive: true });
  const manifest = [];
  for (const p of photoFixtures) {
    const md5 = crypto.createHash('md5').update(p.file).digest('hex');
    const url = `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.slice(0,2)}/${p.file}`;
    const target = path.join(fixtureDirectory, p.id + '.jpg');
    if (!fs.existsSync(target)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'SmartFloorPlannerEvaluation/1.0 (public CC0 fixture research)' } });
      if (!response.ok) throw Error(`Fixture ${p.id}: HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 10 * 1024 * 1024 || data[0] !== 255 || data[1] !== 216) throw Error('Invalid JPEG fixture');
      const normalized = p.id === 'bathroom' ? await sharp(data).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer() : data;
      fs.writeFileSync(target, normalized, { flag: 'wx' });
    }
    const data = fs.readFileSync(target);
    if (crypto.createHash('sha256').update(data).digest('hex') !== hashes[p.id]) throw Error('Fixture changed: ' + p.id);
    manifest.push({ ...p, url, sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length });
  }
  fs.writeFileSync(path.join(fixtureDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
}
if (process.argv[1]?.endsWith('assistant-p2m-photo-fixtures.mjs')) main().catch(e => { console.error(e.message); process.exitCode = 1; });

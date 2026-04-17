import dbConnect from '../src/lib/mongodb';
import Inspiration from '../src/models/Inspiration';

const sampleCases = [
  {
    title: '现代简约 · 曼哈顿晨曦',
    style: '现代简约',
    roomType: '客厅',
    coverImage: 'https://images.unsplash.com/photo-1600210492493-09470512f6ec?auto=format&fit=crop&w=400&q=80',
    renderingImage: 'https://images.unsplash.com/photo-1600210492493-09470512f6ec?auto=format&fit=crop&w=1200&q=80',
    viewCount: 1250,
    isRecommended: true,
    layoutData: [
      { id: 'r1', name: '客厅', width: 500, height: 400, openings: [{ type: 'WINDOW', width: 200, x: 150, y: 0, rotation: 0 }] }
    ]
  },
  {
    title: '侘寂之美 · 静谧空间',
    style: '侘寂风',
    roomType: '客厅',
    coverImage: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=400&q=80',
    renderingImage: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80',
    viewCount: 890,
    isRecommended: true,
    layoutData: [
      { id: 'r2', name: '客厅', width: 450, height: 450, openings: [{ type: 'DOOR', width: 90, x: 0, y: 300, rotation: 90 }] }
    ]
  },
  {
    title: '轻法式奶油 · 浪漫午后',
    style: '轻法式奶油',
    roomType: '主卧',
    coverImage: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=400&q=80',
    renderingImage: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
    viewCount: 2100,
    isRecommended: false,
    layoutData: [
      { id: 'r3', name: '卧室', width: 350, height: 400, openings: [] }
    ]
  }
];

async function seed() {
  try {
    await dbConnect();
    await Inspiration.deleteMany({});
    await Inspiration.insertMany(sampleCases);
    console.log('Seed data inserted successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
}

seed();

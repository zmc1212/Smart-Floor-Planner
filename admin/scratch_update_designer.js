
const mongoose = require('mongoose');

async function update() {
  await mongoose.connect("mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin");
  const SystemRole = mongoose.model('SystemRole', new mongoose.Schema({}, { strict: false }));
  
  // Update designer
  const result = await SystemRole.updateOne(
    { roleKey: 'designer' },
    { $set: { menuKeys: ["dashboard", "leads", "floorplans", "measurements", "ai-designer", "ai-floorplan", "ai-furnishing", "ai-soft-furnishing", "inspirations", "promotion-records"] } }
  );
  console.log('Update designer result:', result);

  await mongoose.disconnect();
}

update();

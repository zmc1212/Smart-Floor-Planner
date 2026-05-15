
const mongoose = require('mongoose');

async function update() {
  await mongoose.connect("mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin");
  const SystemRole = mongoose.model('SystemRole', new mongoose.Schema({}, { strict: false }));
  
  // Update salesperson
  const result = await SystemRole.updateOne(
    { roleKey: 'salesperson' },
    { $set: { menuKeys: ["dashboard", "leads", "floorplans", "promotion-records"] } }
  );
  console.log('Update salesperson result:', result);

  // Update designer (optional, but let's make sure it has promotion-records too if needed)
  // Designer currently has: ["dashboard", "leads", "floorplans", "measurements", "ai-designer", "ai-floorplan", "ai-furnishing", "ai-soft-furnishing", "inspirations"]
  
  await mongoose.disconnect();
}

update();

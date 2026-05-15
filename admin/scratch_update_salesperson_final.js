
const mongoose = require('mongoose');

async function update() {
  await mongoose.connect("mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin");
  const SystemRole = mongoose.model('SystemRole', new mongoose.Schema({}, { strict: false }));
  
  // Update salesperson to ONLY have dashboard and promotion-records
  const result = await SystemRole.updateOne(
    { roleKey: 'salesperson' },
    { $set: { menuKeys: ["dashboard", "promotion-records"] } }
  );
  console.log('Update salesperson result:', result);

  await mongoose.disconnect();
}

update();

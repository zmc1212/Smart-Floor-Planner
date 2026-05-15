
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect("mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin");
  const SystemRole = mongoose.model('SystemRole', new mongoose.Schema({}, { strict: false }));
  const roles = await SystemRole.find();
  console.log(JSON.stringify(roles, null, 2));
  await mongoose.disconnect();
}

check();

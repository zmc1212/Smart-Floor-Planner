
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect("mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin");
  const AdminUser = mongoose.model('AdminUser', new mongoose.Schema({}, { strict: false }));
  const user = await AdminUser.findOne({ username: 'ditui01' });
  console.log(JSON.stringify(user, null, 2));
  await mongoose.disconnect();
}

check();

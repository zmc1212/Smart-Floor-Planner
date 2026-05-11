
const mongoose = require('mongoose');

const uri = "mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin";

async function run() {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const adminUsers = db.collection("adminusers");

    const grh = await adminUsers.findOne({ username: 'grh' });
    console.log(JSON.stringify(grh, null, 2));
  } catch (e) {
      console.log(JSON.stringify({ error: e.message }));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.dir);

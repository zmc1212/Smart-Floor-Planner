
const mongoose = require('mongoose');

const uri = "mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin";

async function run() {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const records = db.collection("promotionenterpriserecords");

    const record = await records.findOne({ enterpriseName: "万总的装修公司" });
    console.log(JSON.stringify(record, null, 2));
  } catch (e) {
      console.log(JSON.stringify({ error: e.message }));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.dir);

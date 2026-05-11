
const mongoose = require('mongoose');

const uri = "mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin";

async function run() {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const enterprises = db.collection("enterprises");

    const ent = await enterprises.findOne({ _id: new mongoose.Types.ObjectId("6a017d016946e8eb7199518a") });
    console.log(JSON.stringify(ent, null, 2));
  } catch (e) {
      console.log(JSON.stringify({ error: e.message }));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.dir);

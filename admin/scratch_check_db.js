
const mongoose = require('mongoose');

const uri = "mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin";

async function run() {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const adminUsers = db.collection("adminusers");
    const records = db.collection("promotionenterpriserecords");

    const grh = await adminUsers.findOne({ username: 'grh' });
    if (!grh) {
      console.log(JSON.stringify({ error: 'User grh not found' }));
      return;
    }

    const grhRecords = await records.find({ promoterId: grh._id }).toArray();
    const grhRecordsByString = await records.find({ promoterId: grh._id.toString() }).toArray();
    const grhRecordsByObjectId = await records.find({ promoterId: new mongoose.Types.ObjectId(grh._id) }).toArray();
    
    const allRecords = await records.find({}).limit(10).toArray();

    console.log(JSON.stringify({
      grhId: grh._id,
      grhIdType: typeof grh._id,
      grhRole: grh.role,
      recordCountByRawId: grhRecords.length,
      recordCountByStringId: grhRecordsByString.length,
      recordCountByObjectId: grhRecordsByObjectId.length,
      sampleRecords: allRecords.map(r => ({
        id: r._id,
        enterpriseName: r.enterpriseName,
        promoterId: r.promoterId,
        promoterIdType: typeof r.promoterId,
        promoterIdConstructor: r.promoterId?.constructor?.name,
        promoterIdString: String(r.promoterId)
      }))
    }, null, 2));
  } catch (e) {
      console.log(JSON.stringify({ error: e.message }));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.dir);

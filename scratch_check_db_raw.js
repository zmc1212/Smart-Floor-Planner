
const { MongoClient, ObjectId } = require('mongodb');

const uri = "mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db("fastMeasure");
    const adminUsers = db.collection("adminusers");
    const records = db.collection("promotionenterpriserecords");

    const grh = await adminUsers.findOne({ username: 'grh' });
    if (!grh) {
      console.log(JSON.stringify({ error: 'User grh not found' }));
      return;
    }

    const grhRecords = await records.find({ promoterId: grh._id }).toArray();
    const grhRecordsByString = await records.find({ promoterId: grh._id.toString() }).toArray();
    const allRecords = await records.find({}).limit(5).toArray();

    console.log(JSON.stringify({
      grhId: grh._id,
      grhIdType: typeof grh._id,
      grhRole: grh.role,
      recordCountByObjectId: grhRecords.length,
      recordCountByStringId: grhRecordsByString.length,
      sampleRecords: allRecords.map(r => ({
        id: r._id,
        enterpriseName: r.enterpriseName,
        promoterId: r.promoterId,
        promoterIdType: typeof r.promoterId,
        isObjectId: r.promoterId instanceof ObjectId
      }))
    }, null, 2));
  } finally {
    await client.close();
  }
}

run().catch(console.dir);

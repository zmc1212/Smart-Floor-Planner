const mongoose = require('mongoose');

async function checkData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smart-floor-planner');
    console.log('Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const adminUsers = await db.collection('adminusers').find({}).toArray();
    console.log('Total AdminUsers:', adminUsers.length);
    
    if (adminUsers.length > 0) {
      console.log('Sample Role:', adminUsers[0].role);
      console.log('Sample EnterpriseId:', adminUsers[0].enterpriseId);
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkData();

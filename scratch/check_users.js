const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../admin/.env.local') });

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const users = await mongoose.connection.collection('adminusers').find({}).limit(10).toArray();
    console.log('Admin Users:');
    users.forEach(u => {
      console.log(`- Username: "${u.username}", Role: ${u.role}, Status: ${u.status}, ID: ${u._id}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();

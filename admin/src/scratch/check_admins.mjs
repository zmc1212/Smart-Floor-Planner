import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), 'admin/.env.local') });

async function checkAdmins() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) return;

  const admins = await db.collection('adminusers').find({}).toArray();
  console.log('Admins data:');
  admins.forEach(a => {
    console.log(`- ${a.username} (${a.role}) | EnterpriseID: ${a.enterpriseId}`);
  });

  await mongoose.disconnect();
}

checkAdmins();

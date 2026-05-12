import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const AdminUserSchema = new mongoose.Schema({
  phone: String,
  openid: String,
  name: String,
  status: String,
  enterpriseId: mongoose.Schema.Types.ObjectId
}, { collection: 'adminusers' });

const DeviceSchema = new mongoose.Schema({
  macAddress: String,
  name: String,
  assignedUserId: mongoose.Schema.Types.ObjectId,
  enterpriseId: mongoose.Schema.Types.ObjectId
}, { collection: 'devices' });

const AdminUser = mongoose.models.AdminUser || mongoose.model('AdminUser', AdminUserSchema);
const Device = mongoose.models.Device || mongoose.model('Device', DeviceSchema);

async function check() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smart-floor-planner');
  
  const user = await AdminUser.findOne({ phone: '13164649409' });
  console.log('User found:', user);
  
  if (user) {
    const devices = await Device.find({ assignedUserId: user._id });
    console.log('Devices assigned to user:', devices);
    
    const allUsers = await AdminUser.find({ phone: '13164649409' });
    if (allUsers.length > 1) console.log('Multiple users with this phone:', allUsers);
  }
  
  process.exit(0);
}

check().catch(console.error);
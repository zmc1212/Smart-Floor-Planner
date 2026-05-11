const mongoose = require('mongoose');

async function checkUsers() {
  try {
    await mongoose.connect('mongodb://root:123456@localhost:27017/fastMeasure?authSource=admin');

    const UserSchema = new mongoose.Schema({
      username: String,
      status: String,
      role: String,
      passwordHash: String
    });

    // Check both User and AdminUser models
    const AdminUser = mongoose.models.AdminUser || mongoose.model('AdminUser', UserSchema, 'adminusers');
    const User = mongoose.models.User || mongoose.model('User', UserSchema, 'users');

    console.log('--- AdminUsers ---');
    const admins = await AdminUser.find({});
    admins.forEach(u => console.log(`- ${u.username} (${u.role}) status: ${u.status} hashLen: ${u.passwordHash?.length || 0}`));

    console.log('\n--- Users ---');
    const users = await User.find({});
    users.forEach(u => console.log(`- ${u.phone || u.username} (${u.role})`));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkUsers();

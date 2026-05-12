const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const uri = process.env.MONGODB_URI;

async function init() {
    try {
        await mongoose.connect(uri);
        const db = mongoose.connection.db;
        const adminCol = db.collection('adminusers');

        const exists = await adminCol.findOne({ username: 'admin' });
        if (!exists) {
            const hash = await bcrypt.hash('admin123', 10);
            await adminCol.insertOne({
                username: 'admin',
                passwordHash: hash,
                displayName: '系统管理员',
                role: 'super_admin',
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log("✅ 初始账号创建成功: admin / admin123");
        } else {
            console.log("✔️ 账号已存在，无需初始化");
        }
        process.exit(0);
    } catch (e) {
        console.error("❌ 初始化失败:", e);
        process.exit(1);
    }
}
init();


const mongoose = require('mongoose');
const { AdminUser } = require('./admin/src/models/AdminUser');
const { PromotionEnterpriseRecord } = require('./admin/src/models/PromotionEnterpriseRecord');

// Mock dbConnect since we are running in node
async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smart-floor-planner');
        const grh = await AdminUser.findOne({ username: 'grh' });
        if (!grh) {
            console.log(JSON.stringify({ error: 'User grh not found' }));
            process.exit(0);
        }
        
        const records = await PromotionEnterpriseRecord.find({ promoterId: grh._id });
        const allRecords = await PromotionEnterpriseRecord.find({}).limit(10);
        
        console.log(JSON.stringify({
            grhId: grh._id,
            grhRole: grh.role,
            recordCountForGrh: records.length,
            sampleRecords: allRecords.map(r => ({
                id: r._id,
                enterpriseName: r.enterpriseName,
                promoterId: r.promoterId,
                promoterIdType: typeof r.promoterId,
                promoterIdString: String(r.promoterId)
            }))
        }, null, 2));
    } catch (e) {
        console.log(JSON.stringify({ error: e.message }));
    } finally {
        await mongoose.disconnect();
    }
}

check();

import mongoose from 'mongoose';
import { dbConnect } from './src/lib/dbConnect';
import { PromotionEnterpriseRecord } from './src/models/PromotionEnterpriseRecord';
import { tenantStorage } from './src/lib/tenant-context';

async function test() {
  try {
    console.log('Connecting to database...');
    await dbConnect();
    
    // grh's context
    // UserId: 69e88c0269057726f64c5727
    // EnterpriseId: 69e1f0a531cee58df08e9d97
    const context = {
      userId: '69e88c0269057726f64c5727',
      role: 'salesperson',
      enterpriseId: '69e1f0a531cee58df08e9d97'
    };

    console.log('\n--- Testing salesperson context (grh) ---');
    console.log('Mock Context:', JSON.stringify(context, null, 2));
    
    await tenantStorage.run(context, async () => {
      // The plugin should log the filter to console due to process.env.NODE_ENV === 'development'
      // Or I can check it manually if I had a spy, but let's see the results.
      
      const count = await PromotionEnterpriseRecord.countDocuments();
      console.log('Record count (total visibility for this user):', count);
      
      const records = await PromotionEnterpriseRecord.find().limit(5);
      console.log('Sample records found:', records.length);
      records.forEach(r => {
        console.log(`- ${r.enterpriseName} | Promoter: ${r.promoterId} | EnterpriseId: ${r.enterpriseId || 'NULL'}`);
      });
      
      if (count > 0) {
        console.log('\nSUCCESS: Data is now visible for salesperson even with an enterpriseId in context.');
      } else {
        console.log('\nFAILURE: Still no records visible. Check plugin logs.');
      }
    });

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

test();

import dbConnect from '../src/lib/mongodb';
import mongoose from 'mongoose';

async function checkData() {
    await dbConnect();
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    for (const col of collections) {
        const name = col.name;
        const count = await mongoose.connection.db.collection(name).countDocuments();
        console.log(`Collection: ${name} (${count} documents)`);
        if (count > 0 && count < 20) {
            const docs = await mongoose.connection.db.collection(name).find().toArray();
            console.log(JSON.stringify(docs, null, 2));
        }
    }
    
    process.exit(0);
}

checkData().catch(err => {
    console.error(err);
    process.exit(1);
});

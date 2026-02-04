const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });

async function listBuckets() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });

    try {
        console.log(`Listing buckets...`);
        const [buckets] = await storage.getBuckets();
        buckets.forEach(bucket => {
            console.log(bucket.name);
        });
    } catch (error) {
        console.error('Error:', error);
    }
}

listBuckets();

const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });

async function peekFile() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';
    const fileName = 'sku_protocol/sku_protocol__all-temp-detergent-5-gal__v0.1.txt';

    try {
        console.log(`Peeking at ${fileName}...`);
        const [content] = await storage.bucket(bucketName).file(fileName).download();
        console.log(content.toString());
    } catch (error) {
        console.error('Error peeking at file:', error);
    }
}

peekFile();

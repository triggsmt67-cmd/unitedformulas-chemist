const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });

async function listFiles() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';

    try {
        console.log(`Listing files in bucket ${bucketName}...`);
        const [files] = await storage.bucket(bucketName).getFiles();
        files.forEach(file => {
            console.log(file.name);
        });
    } catch (error) {
        console.error('Error listing files:', error);
    }
}

listFiles();

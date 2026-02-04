const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });

async function listAllPrefixes() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';

    try {
        console.log(`Deep folder analysis in bucket ${bucketName}...`);
        const [files] = await storage.bucket(bucketName).getFiles();
        const directories = new Set();
        files.forEach(file => {
            const parts = file.name.split('/');
            parts.pop(); // Remove the filename
            if (parts.length > 0) {
                directories.add(parts.join('/'));
            }
        });
        console.log('Unique directories found:', Array.from(directories).sort());
    } catch (error) {
        console.error('Error:', error);
    }
}

listAllPrefixes();

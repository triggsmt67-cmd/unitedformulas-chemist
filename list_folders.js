const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });

async function listFolders() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';

    try {
        console.log(`Analyzing folder structure in bucket ${bucketName}...`);
        const [files] = await storage.bucket(bucketName).getFiles();
        const prefixes = new Set();
        files.forEach(file => {
            const parts = file.name.split('/');
            if (parts.length > 1) {
                prefixes.add(parts[0]);
            }
        });
        console.log('Top level folders:', Array.from(prefixes));
    } catch (error) {
        console.error('Error:', error);
    }
}

listFolders();

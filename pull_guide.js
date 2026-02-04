const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

async function downloadFile() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';
    const fileName = 'product_guide.txt';
    const destFileName = './product_guide_downloaded.txt';

    try {
        console.log(`Downloading ${fileName} from bucket ${bucketName}...`);
        await storage.bucket(bucketName).file(fileName).download({ destination: destFileName });
        console.log(`File ${fileName} downloaded to ${destFileName}.`);
    } catch (error) {
        console.error('Error downloading file:', error);
    }
}

downloadFile();

const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });

async function syncLibrarian() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';
    const fs = require('fs');
    const path = require('path');

    try {
        console.log(`Scanning bucket for technical mapping...`);
        const [files] = await storage.bucket(bucketName).getFiles();

        let guide = "UNITED FORMULAS PRODUCT LIBRARIAN GUIDE\n";
        guide += "========================================\n\n";

        // Add the high-fidelity harvested guide if it exists locally
        const harvestedPath = path.join(__dirname, 'product_guide_harvested.txt');
        if (fs.existsSync(harvestedPath)) {
            guide += "## HARVESTED PRODUCT CATALOG (PRIMARY)\n";
            guide += fs.readFileSync(harvestedPath, 'utf8');
            guide += "\n\n";
        }

        // Find all grounding files
        const groundingFiles = files.filter(f => f.name.startsWith('grounding/'));
        const masterFiles = files.filter(f => f.name.startsWith('sku_master/'));

        guide += "## TECHNICAL GROUNDING (LIVE GCS)\n";
        groundingFiles.forEach(f => {
            const cleanName = f.name.split('grounding__')[1]?.replace('.txt', '').replace(/__/g, ' ') || f.name;
            guide += `- ${cleanName} -> USE FILE: ${f.name}\n`;
        });

        guide += "\n## COMMERCE & METADATA (LIVE GCS)\n";
        masterFiles.forEach(f => {
            const cleanName = f.name.split('sku_master__')[1]?.replace('.txt', '').replace(/__v1/g, '').replace(/-/g, ' ') || f.name;
            guide += `- ${cleanName} -> USE FILE: ${f.name}\n`;
        });

        await storage.bucket(bucketName).file('product_guide.txt').save(guide);
        console.log("✅ Librarian guide synced and uploaded to GCS.");
    } catch (error) {
        console.error('Error:', error);
    }
}

syncLibrarian();

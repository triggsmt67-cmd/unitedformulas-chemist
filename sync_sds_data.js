const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

async function mergeAndUpload() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';

    // Path to your SDS Intake App exports
    const exportsDir = '/Users/trevorriggs/Desktop/SDS Intake App/exports';

    // Ensure we don't modify anything in the SDS Intake App
    if (!fs.existsSync(exportsDir)) {
        console.error('❌ Could not find SDS Intake App exports directory.');
        return;
    }

    const products = fs.readdirSync(exportsDir).filter(f =>
        fs.statSync(path.join(exportsDir, f)).isDirectory()
    );

    console.log(`🚀 Found ${products.length} processed products in storage. Starting consolidation...`);

    for (const productDir of products) {
        const sectionsPath = path.join(exportsDir, productDir, 'sections');
        if (!fs.existsSync(sectionsPath)) continue;

        const sectionFiles = fs.readdirSync(sectionsPath).filter(f => f.endsWith('.txt')).sort();

        let consolidatedMarkdown = `# TECHNICAL MASTER DATA: ${productDir.toUpperCase()}\n`;
        consolidatedMarkdown += `Generated: ${new Date().toISOString()}\n\n`;

        for (const file of sectionFiles) {
            const sectionContent = fs.readFileSync(path.join(sectionsPath, file), 'utf8');
            const sectionName = file.split('__sec-')[1].replace('.txt', '').replace(/-/g, ' ').toUpperCase();

            consolidatedMarkdown += `## SECTION ${sectionName}\n`;
            consolidatedMarkdown += sectionContent + '\n\n';
        }

        const destinationBlobName = `grounding/grounding__${productDir}.txt`;

        try {
            console.log(`📦 Merged ${sectionFiles.length} sections for ${productDir}. Uploading to GCS...`);
            await storage.bucket(bucketName).file(destinationBlobName).save(consolidatedMarkdown);
            console.log(`✅ Successfully uploaded: ${destinationBlobName}`);
        } catch (error) {
            console.error(`❌ Failed to upload ${productDir}:`, error.message);
        }
    }

    console.log('\n✨ All technical data is now consolidated and active in the Chemist\'s brain.');
}

mergeAndUpload();

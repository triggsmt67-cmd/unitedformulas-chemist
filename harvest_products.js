const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

async function harvest() {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';
    const folderName = 'sku_protocol/';

    try {
        console.log(`🚀 Harvesting product data from ${bucketName}/${folderName}...`);
        const [files] = await storage.bucket(bucketName).getFiles({ prefix: folderName });

        // Filter out the folder itself if it appears as an object
        const targetFiles = files.filter(f => f.name.endsWith('.txt'));
        console.log(`Found ${targetFiles.length} protocol files. Processing all for the master guide...`);

        let harvestData = "# UNITED FORMULAS COLLATED PRODUCT GUIDE\n";
        harvestData += "# Format: Product Name | Summary/Use | Protocols/Notes\n\n";

        // Process all found files
        for (let i = 0; i < targetFiles.length; i++) {
            const file = targetFiles[i];
            try {
                const [content] = await file.download();
                const text = content.toString();

                // Simple extraction logic
                const nameMatch = text.match(/product_name:\s*(.*)/i);
                const name = nameMatch ? nameMatch[1].trim() : file.name.split('__')[1] || 'Unknown Product';

                // Content sections
                const useSection = text.split('## Intended Use')[1]?.split('##')[0]?.trim() || 'General Industrial Use';
                const cleanUse = useSection.replace(/\n/g, ' ').replace(/UNKNOWN.*/i, 'Chemical Formulation').substring(0, 150);

                const protocolSection = text.split('## Quick Start')[1]?.split('##')[0]?.trim() || 'Contact Support';
                const cleanProtocol = protocolSection.replace(/\n/g, ' ').replace(/REQUIRES_LABEL.*/i, 'Professional Protocol Required').substring(0, 150);

                harvestData += `${name} | ${cleanUse} | ${cleanProtocol}\n`;

                if ((i + 1) % 10 === 0) console.log(`Processed ${i + 1}/${targetFiles.length}...`);
            } catch (err) {
                console.error(`Error processing ${file.name}:`, err.message);
            }
        }

        fs.writeFileSync('product_guide_harvested.txt', harvestData);
        console.log(`\n✅ Harvest complete! Data saved to product_guide_harvested.txt`);
    } catch (error) {
        console.error('Harvesting error:', error);
    }
}

harvest();

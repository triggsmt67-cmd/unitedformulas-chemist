const fs = require('fs');
const path = require('path');

// Configuration
const CSV_PATH = path.join(__dirname, 'UF Product Enrichment', 'UF Chemist enrichment.csv');
const METADATA_PATH = path.join(__dirname, 'src', 'data', 'product_metadata.json');
const USE_CASES_PATH = path.join(__dirname, 'src', 'data', 'use_cases.json');

/**
 * Simple CSV parser that handles quoted values with commas
 */
function parseCSV(content) {
    // Handle Byte Order Mark (BOM)
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    const lines = content.split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const results = [];

    console.log('CSV Headers:', headers);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const row = [];
        let currentField = '';
        let inQuotes = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"' && line[j + 1] === '"') {
                currentField += '"';
                j++;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(currentField.trim());
                currentField = '';
            } else {
                currentField += char;
            }
        }
        row.push(currentField.trim());

        const obj = {};
        headers.forEach((header, index) => {
            const val = row[index] || '';
            obj[header] = val.trim().replace(/^"|"$/g, '');
        });
        results.push(obj);
    }
    return results;
}

function cleanDescription(text) {
    if (!text) return '';
    return text
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

async function harvest() {
    console.log('Reading CSV...');
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const products = parseCSV(csvContent);

    let metadata = {};
    // Start fresh or load existing? Let's load existing but allow overwriting if CSV has better data
    if (fs.existsSync(METADATA_PATH)) {
        metadata = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
    }

    console.log(`Processing ${products.length} entries...`);

    // First pass: identify base products (those with descriptions)
    products.forEach(p => {
        const sku = p.SKU || '';
        const name = p.Name || '';
        const shortDesc = p['Short description'] || '';
        const longDesc = p.Description || '';
        const categories = p.Categories || '';

        // If it has a significant description, treat it as a primary product entry
        if (sku && (shortDesc.length > 5 || longDesc.length > 5)) {
            console.log(`Ingesting product: ${sku}`);
            metadata[sku] = {
                displayName: name,
                canonicalDescription: cleanDescription(shortDesc || longDesc),
                category: categories,
                variants: metadata[sku]?.variants || []
            };
        }
    });

    // Second pass: link variants
    products.forEach(p => {
        const sku = p.SKU || '';
        const shortDesc = p['Short description'] || '';

        if (sku && !shortDesc) {
            for (const baseSku in metadata) {
                if (sku.startsWith(baseSku) && sku !== baseSku) {
                    if (!metadata[baseSku].variants.includes(sku)) {
                        metadata[baseSku].variants.push(sku);
                        console.log(`Linked variant ${sku} -> ${baseSku}`);
                    }
                }
            }
        }
    });

    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 4));
    console.log(`Saved ${Object.keys(metadata).length} base products to metadata.`);
    console.log('Harvesting complete!');
}

harvest().catch(console.error);

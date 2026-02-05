import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Storage } from '@google-cloud/storage';
import { LRUCache } from 'lru-cache';

const PDFParser = require("pdf2json");

// Initialize Cache (5 minute TTL for GCS metadata)
// This prevents redundant GCS calls for every chat message
const cache = new LRUCache<string, any>({
    max: 10,
    ttl: 1000 * 60 * 5,
});

// Initialize GCS
const storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');
// gemini-2.0-flash is significantly faster than previous versions
const modelFlash = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function POST(req: NextRequest) {
    try {
        const { message, history } = await req.json();

        // 1. Get Metadata (Cached)
        let metadata = cache.get('gcs_metadata');
        if (!metadata) {
            console.log("Fetching fresh GCS metadata...");
            // Run GCS calls in parallel to save time
            const [filesRepo, guideContent] = await Promise.all([
                storage.bucket(bucketName).getFiles(),
                (async () => {
                    try {
                        const file = storage.bucket(bucketName).file('product_guide.txt');
                        const [exists] = await file.exists();
                        if (!exists) return "";
                        const [content] = await file.download();
                        return content.toString();
                    } catch { return ""; }
                })()
            ]);

            metadata = {
                fileList: filesRepo[0].map((f: any) => f.name).join('\n'),
                files: filesRepo[0],
                productGuide: guideContent
            };
            cache.set('gcs_metadata', metadata);
        }

        const { fileList, files, productGuide } = metadata;

        // 2. Step 1: Identify Relevant File
        const selectionPrompt = `
      You are the "Master Librarian" for United Formulas. 
      Your job is to pick the BEST file to answer the user's question.

      USER QUESTION: "${message}"

      PRODUCT GUIDE (MAPPING):
      ${productGuide}

      AVAILABLE FILES:
      ${fileList}

      SELECTION RULES:
      1. If the user asks about FIRST AID, SAFETY, HAZARDS, or EMERGENCY protocols, you MUST prioritize files in the "grounding/" folder.
      2. If the user asks about PRICING, SKU, or COMMERCE, look in the "sku_master/" folder.
      3. Use the PRODUCT GUIDE to map names like "Dynamo" or "Panhandler" to their technical files.
      4. If the user is asking for a RECOMMENDATION, COMPARISON, or a LIST of products (e.g., "What degreasers do you have?"), return "GUIDE".
      5. RETURN ONLY THE FILENAME (e.g., grounding/grounding__xyz.txt) or "GUIDE" or "NONE".
      6. If no specific file or category matches, return "NONE".
    `;

        const selectionResult = await modelFlash.generateContent(selectionPrompt);
        let selectedFile = selectionResult.response.text().trim();

        // Clean up markdown or prefix if model hallucinations them
        if (selectedFile.includes('```')) {
            const match = selectedFile.match(/```(?:\w+)?\n([\s\S]*?)```/);
            if (match) selectedFile = match[1].trim();
        }
        // Remove trailing or leading quotes/extra words
        selectedFile = selectedFile.split('\n')[0].replace(/['"`]/g, '').trim();

        console.log(`Selected Context File: ${selectedFile}`);

        let contextData = "No specific technical record found for this product. Answer based on the Product Guide or general chemistry principles.";

        // 3. Step 2: Retrieve & Parse Content
        if (selectedFile === 'GUIDE') {
            contextData = `FULL PRODUCT CATALOG & MAPPING GUIDE:\n${productGuide}`;
        } else if (selectedFile !== 'NONE' && selectedFile.length > 0) {
            try {
                // Exact match check
                const fileRecord = files.find((f: any) => f.name === selectedFile);
                if (fileRecord) {
                    const [fileBuffer] = await storage.bucket(bucketName).file(selectedFile).download();

                    if (selectedFile.toLowerCase().endsWith('.pdf')) {
                        const pdfParser = new PDFParser(null, 1);
                        const pdfText: string = await new Promise((resolve, reject) => {
                            pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
                            pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
                            pdfParser.parseBuffer(fileBuffer);
                        });
                        contextData = `TECHNICAL RECORD FOR: ${selectedFile}\nCONTENT:\n${pdfText.slice(0, 30000)}`;
                    } else {
                        contextData = `TECHNICAL RECORD FOR: ${selectedFile}\nCONTENT:\n${fileBuffer.toString()}`;
                    }
                }
            } catch (err) {
                console.error("Error reading file:", err);
            }
        }

        // 4. Step 3: Generate Answer
        const systemInstruction = `
      You are "Ask the Chemist", a lead chemical intelligence suite and formulation expert for United Formulas.
      Your goal is to provide safety protocols, technical grounding, and professional product recommendations from the United Formulas catalog.

      CRITICAL SAFETY RULES:
      1. ALWAYS verify that the retrieved context matches the product the user is asking about.
      2. If you are providing FIRST AID information, you MUST ensure it belongs to the EXACT product requested.
      3. If the context provided does not match the product or is generic, DO NOT guess. Specify that the exact technical grounding for that product is not currently in the vault.
      
      PRODUCT RECOMMENDATIONS:
      - Use the provided PRODUCT GUIDE to suggest products that fit the user's use case (e.g., degreasers, floor cleaners, detergents).
      - If multiple products fit a family (like "Dynamo-X Commercial" vs "Dynamo-X Industrial"), explain the difference based on the names or any available metadata.
      - Be helpful and proactive in suggesting the right United Formulas solution.

      FIRST AID & SAFETY:
      - Prioritize "First Aid Measures" or "Hazards Identification" sections.
      - Provide clear, step-by-step emergency instructions.
      - ALWAYS include this disclaimer: "NOTE: In a medical emergency, call 911 or your local poison control center immediately."
      
      MARKDOWN RULES:
      1. Format links as: [View SDS PDF](URL)
      2. Do not show raw URLs.
      
      RETRIEVED CONTEXT:
      ${contextData}
    `;

        let mappedHistory = history.map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
        }));
        // Clean up history for API compatibility
        while (mappedHistory.length > 0 && mappedHistory[0].role === 'model') {
            mappedHistory.shift();
        }

        const chat = modelFlash.startChat({
            history: mappedHistory,
        });

        const result = await chat.sendMessage(`${systemInstruction}\n\nUSER QUESTION: ${message}`);
        const responseText = result.response.text();

        return NextResponse.json({ response: responseText });

    } catch (error: any) {
        console.error('Error in Chat API:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

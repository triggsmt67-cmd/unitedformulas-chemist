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
      4. RETURN ONLY THE FILENAME. If no file matches, return "NONE".
    `;

        const selectionResult = await modelFlash.generateContent(selectionPrompt);
        const selectedFile = selectionResult.response.text().trim();
        console.log(`Selected Context File: ${selectedFile}`);

        let contextData = "No specific file found. Answer based on general knowledge.";

        // 3. Step 2: Retrieve & Parse Content
        if (selectedFile !== 'NONE' && selectedFile.length > 0) {
            try {
                if (files.some((f: any) => f.name === selectedFile)) {
                    const [fileBuffer] = await storage.bucket(bucketName).file(selectedFile).download();

                    if (selectedFile.toLowerCase().endsWith('.pdf')) {
                        const pdfParser = new PDFParser(null, 1);
                        const pdfText: string = await new Promise((resolve, reject) => {
                            pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
                            pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
                            pdfParser.parseBuffer(fileBuffer);
                        });
                        contextData = `CONTENT OF FILE "${selectedFile}":\n${pdfText.slice(0, 30000)}`;
                    } else {
                        contextData = `CONTENT OF FILE "${selectedFile}":\n${fileBuffer.toString()}`;
                    }
                }
            } catch (err) {
                console.error("Error reading file:", err);
            }
        }

        // 4. Step 3: Generate Answer
        const systemInstruction = `
      You are "Ask the Chemist", a high-priority chemical safety and technical consultant for United Formulas.
      
      CRITICAL INSTRUCTION: FIRST AID & SAFETY
      1. If a user asks about first aid, exposure, or safety, you must prioritize finding the "First Aid Measures" or "Hazards Identification" sections in the provided context.
      2. Provide clear, step-by-step emergency instructions from the document.
      3. ALWAYS include this disclaimer at the bottom of safety responses: "NOTE: In a medical emergency, call 911 or your local poison control center immediately."
      
      MARKDOWN RULES:
      1. Format links as: [View SDS PDF](URL)
      2. Do not show raw URLs.
      
      ANSWERING DISCIPLINE:
      - Use the PROVIDED CONTEXT to answer. 
      - If the context does not contain the answer, specify that the information is not in the current technical record and recommend contacting professional support.
      
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

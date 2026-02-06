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

// Initialize GCS with flexible credential handling for deployment
// Priority: Base64-encoded credentials (production) > File path (local development)
const getGCSStorage = () => {
    // For production: Use Base64-encoded service account JSON
    if (process.env.GCS_CREDENTIALS_BASE64) {
        const credentials = JSON.parse(
            Buffer.from(process.env.GCS_CREDENTIALS_BASE64, 'base64').toString('utf-8')
        );
        return new Storage({ credentials });
    }
    // For local development: Use file path
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
    }
    // Fallback: Use default application credentials (GCE, Cloud Run, etc.)
    return new Storage();
};
const storage = getGCSStorage();
const bucketName = process.env.GCS_BUCKET_NAME || 'united-formulas-files';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');
// gemini-2.0-flash is significantly faster than previous versions
const modelFlash = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const message = body?.message;
        const history = body?.history || [];

        // Input validation (fail fast)
        if (!message || typeof message !== 'string') {
            return NextResponse.json(
                { error: 'Invalid request', code: 'VALIDATION_ERROR', details: 'Message is required' },
                { status: 400 }
            );
        }

        // 1. Get Metadata (Cached)
        let metadata = cache.get('gcs_metadata');
        if (!metadata) {
            console.log("Fetching fresh GCS metadata...");
            // Run GCS calls in parallel to save time
            const [filesRepo, guideContent, zipcodesContent] = await Promise.all([
                storage.bucket(bucketName).getFiles(),
                (async () => {
                    try {
                        const file = storage.bucket(bucketName).file('product_guide.txt');
                        const [exists] = await file.exists();
                        if (!exists) return "";
                        const [content] = await file.download();
                        return content.toString();
                    } catch (err) {
                        console.warn('Failed to load product_guide.txt:', err);
                        return "";
                    }
                })(),
                (async () => {
                    try {
                        const file = storage.bucket(bucketName).file('delivery_zipcodes.json');
                        const [exists] = await file.exists();
                        if (!exists) return "";
                        const [content] = await file.download();
                        return content.toString();
                    } catch (err) {
                        console.warn('Failed to load delivery_zipcodes.json:', err);
                        return "";
                    }
                })()
            ]);

            metadata = {
                fileList: filesRepo[0].map((f: any) => f.name).join('\n'),
                files: filesRepo[0],
                productGuide: guideContent,
                zipcodes: zipcodesContent
            };

            // Local fallback for product guide if GCS is empty
            if (!metadata.productGuide) {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const localPath = path.join(process.cwd(), 'product_guide_harvested.txt');
                    if (fs.existsSync(localPath)) {
                        metadata.productGuide = fs.readFileSync(localPath, 'utf-8');
                        console.log("Using local product_guide_fallback (harvested).");
                    }
                } catch (e) {
                    console.warn("Local guide fallback failed:", e);
                }
            }

            console.log(`Metadata loaded. Guide length: ${metadata.productGuide?.length || 0}`);
            cache.set('gcs_metadata', metadata);
        }

        const { fileList, files, productGuide, zipcodes } = metadata;

        // 2. Step 1: Identify Relevant File
        const recentHistory = history.slice(-6).map((h: any) => `${h.role}: ${h.content}`).join('\n');
        const selectionPrompt = `
      You are the "Master Librarian" for United Formulas. 
      Your job is to pick the BEST file to answer the user's question.

      RECENT CONTEXT:
      ${recentHistory}

      USER QUESTION: "${message}"

      PRODUCT GUIDE (MAPPING names to technical files):
      ${productGuide}

      AVAILABLE FILES:
      ${fileList}

      SELECTION RULES:
      1. SEARCH & TYPOS (TOP PRIORITY): If the user is searching for a category, use-case, or chemical (e.g. "car wash", "karr wassh", "asphlat", "flore soap", "dish soap", "degreaser", "pot and pan", "clner"), RETURN "GUIDE".
      2. DIRECT MATCH: If a product name is mentioned (e.g. "Nugget Car Wash", "Ace"), pick its grounding file.
      3. PRONOUNS: If the user says "it", "this", "that", "the product", resolve it to the specific product from RECENT CONTEXT and pick its file. 
      4. CATEGORY MAPPINGS: Be EXTREMELY aggressive with typos. 
         - Any mention of "wash", "wassh", "cleaner", "clner", "soap", "detergent", "degreaser", "acid", "caustic", "sanitizer" -> GUIDE
      5. CLARIFY: Only return "CLARIFY" if they ask a technical/safety question ("Is it toxic?") but no product name has been mentioned yet and context is empty.
      6. RETURN ONLY THE FILENAME or "GUIDE" or "DELIVERY" or "CLARIFY" or "NONE" or "GENERAL".
    `;

        // Safety Catch-all for Category Searches (Fuzzy Support)
        const qLower = message.toLowerCase();
        const categoryKeywords = ['wash', 'cleaner', 'clner', 'wassh', 'soap', 'detergent', 'degreas', 'acid', 'caustic', 'sanitiz', 'mop', 'wax', 'polish', 'dish'];
        const isLikelySearch = categoryKeywords.some(k => qLower.includes(k));

        let selectedFile = "";
        if (isLikelySearch) {
            console.log("Category keyword detected, forcing GUIDE mode.");
            selectedFile = "GUIDE";
        } else {
            const selectionResult = await modelFlash.generateContent(selectionPrompt);
            selectedFile = selectionResult.response.text().trim();
        }

        // Robust cleanup: find the FIRST occurrence of a valid keyword
        const keywords = ['GUIDE', 'DELIVERY', 'CLARIFY', 'NONE', 'GENERAL'];
        const upperSelected = selectedFile.toUpperCase();
        for (const kw of keywords) {
            if (upperSelected.includes(kw)) {
                selectedFile = kw;
                break;
            }
        }

        // Final fallback cleanup for filenames (remove markdown/quotes)
        selectedFile = selectedFile.replace(/```(?:\w+)?/g, '').replace(/['"`]/g, '').split('\n')[0].trim();

        console.log(`Final Selected Context: ${selectedFile}`);

        let contextData = "No specific technical record found. Answer based on general knowledge or ask for clarification if a product is needed.";

        // 3. Step 2: Retrieve & Parse Content
        if (selectedFile === 'CLARIFY') {
            contextData = "STATUS: NO PRODUCT NAMED. You MUST ask which product they are referring to before providing safety or technical details. Do not guess the product.";
        } else if (selectedFile === 'GUIDE') {
            contextData = `STATUS: PRODUCT IDENTIFIED (CATALOG). FULL PRODUCT CATALOG & MAPPING GUIDE:\n${productGuide}`;
        } else if (selectedFile === 'DELIVERY') {
            let parsedZips: any[] = [];
            try {
                parsedZips = zipcodes ? JSON.parse(zipcodes) : [];
            } catch (err) {
                console.error('Failed to parse zipcodes JSON:', err);
            }
            const zipList = parsedZips.map((z: any) => `${z.zip}: ${z.city} (${z.county})`).join('\n');
            contextData = `DELIVERY & SHIPPING CONTEXT:
            VALID DELIVERY LOCATIONS:
            ${zipList || "No specific zipcode data found."}

            GENERAL POLICY: We aim to ship all orders the next day. Local delivery is standard same/next day. Our main routes cover Great Falls and Billings regions.`;
        } else if (selectedFile === 'NONE') {
            // Safe findLast alternative for broader runtime compatibility
            const reversedHistory = [...history].reverse();
            const lastUserMsg = reversedHistory.find((msg: any) => msg.role === 'user')?.content || "";
            contextData = `STATUS: UNKNOWN PRODUCT. The user mentioned "${lastUserMsg}", but we do not have a technical record for it. Acknowledge this name specifically and offer general guidance.`;
        } else if (selectedFile === 'GENERAL') {
            contextData = `STATUS: OUT OF SCOPE. The user's question is unrelated to chemistry, products, or delivery. Politely acknowledge that as a chemical safety assistant, you don't have access to that information, but offer to help with anything related to United Formulas.`;
        } else if (selectedFile !== 'NONE' && selectedFile !== 'GENERAL' && selectedFile.length > 0) {
            contextData = `STATUS: PRODUCT IDENTIFIED.`;
            try {
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
                        contextData = `STATUS: PRODUCT IDENTIFIED.\nTECHNICAL RECORD FOR: ${selectedFile}\nCONTENT:\n${pdfText.slice(0, 30000)}`;
                    } else {
                        contextData = `STATUS: PRODUCT IDENTIFIED.\nTECHNICAL RECORD FOR: ${selectedFile}\nCONTENT:\n${fileBuffer.toString()}`;
                    }
                }
            } catch (err) {
                console.error("Error reading file:", err);
            }
        }

        // 4. Step 3: Generate Answer
        const systemInstruction = `
      GOVERNING CONSTITUTION:
      Your primary responsibility is safety, accuracy, and integrity — not speed, confidence, or conversion.
      You are Dr. Aris, the friendly, professional, and safety-obsessed lead chemical expert for United Formulas.

      ────────────────────────────────
      SOURCE OF TRUTH HIERARCHY
      ────────────────────────────────
      1. Product technical records (SDS/Labels)
      2. Company policy
      3. This governance framework

      ────────────────────────────────
      OPERATIONAL CLARIFICATION RULES:
      ────────────────────────────────
      1. FIRST AID & MEDICAL DISCLAIMER (STRICT): If (and ONLY IF) the user explicitly asks about first aid, exposure, or medical treatment, you MUST start your response with this EXACT sentence: "I am not a medical provider and cannot give medical advice, but here are the first aid instructions directly from our Safety Data Sheet (SDS) for this chemical:"
      2. PROHIBITION: Do NOT include first aid instructions, medical disclaimers, or any "NOTE: In a medical emergency..." text unless specifically requested for safety guidance. Do not repeat the 911 emergency note in general conversation.
      3. GENERAL PRODUCT INFO: If asked "Tell me about [Product]", provide a concise, one-sentence high-level overview.
      4. DIRECTNESS: Provide technical answers immediately. Do NOT ask "Are you referring to..." if they named the product.
      5. STATUS: NO PRODUCT NAMED: Ask "Which United Formulas product are you using or considering?"
      6. STATUS: PRODUCT IDENTIFIED (TECHNICAL): Use the retrieved technical data to provide professional, precise guidance.

      ────────────────────────────────
      DELIVERY & ZIPCODES:
      ────────────────────────────────
      - If delivery but no location: Ask for city or zip.
      - IF FOUND in list: Confirm city and county.
      - IF NOT FOUND: Direct to support.

      RETRIEVED DATA FOR YOUR USE (DO NOT MENTION SOURCE):
      ${contextData}
    `;

        // Initialize model with system instruction
        const chatModel = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            systemInstruction: systemInstruction
        });

        const mappedHistory = history.map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
        }));

        // Clean up history for API compatibility
        while (mappedHistory.length > 0 && mappedHistory[0].role === 'model') {
            mappedHistory.shift();
        }

        const chat = chatModel.startChat({
            history: mappedHistory,
        });

        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

        return NextResponse.json({ response: responseText });

    } catch (error: any) {
        console.error('Error in Chat API:', error);
        const errorMessage = error?.message || 'An unexpected error occurred';
        return NextResponse.json(
            { error: 'Chat request failed', code: 'INTERNAL_ERROR', details: errorMessage },
            { status: 500 }
        );
    }
}

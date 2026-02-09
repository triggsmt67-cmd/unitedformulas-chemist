import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Storage } from '@google-cloud/storage';
import { LRUCache } from 'lru-cache';

const PDFParser = require("pdf2json");
const fs = require('fs');
const path = require('path');

// Initialize Cache (5 minute TTL for GCS metadata)
// This prevents redundant GCS calls for every chat message
const cache = new LRUCache<string, any>({
    max: 10,
    ttl: 1000 * 60 * 5,
});

const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_CONTENT_LENGTH = 6000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

type RateLimitEntry = { count: number; expiresAt: number };
const requestRateLimit = new LRUCache<string, RateLimitEntry>({
    max: 500,
    ttl: RATE_LIMIT_WINDOW_MS,
});

const getClientIp = (req: NextRequest) => {
    const forwardedFor = req.headers.get('x-forwarded-for');
    return forwardedFor?.split(',')[0].trim() || 'unknown';
};

const isRateLimited = (clientIp: string) => {
    const now = Date.now();
    const entry = requestRateLimit.get(clientIp);

    if (!entry || entry.expiresAt <= now) {
        requestRateLimit.set(clientIp, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }

    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
        return true;
    }

    requestRateLimit.set(clientIp, { ...entry, count: entry.count + 1 });
    return false;
};

const sanitizeHistory = (history: unknown) => {
    if (!Array.isArray(history)) return [];

    const trimmedHistory = history
        .filter((msg) => typeof msg === 'object' && msg !== null)
        .map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model', // Updated to match Gemini 'model' role
            content: typeof msg.content === 'string' ? msg.content.slice(0, MAX_MESSAGE_LENGTH) : '',
        }))
        .filter((msg) => msg.content.length > 0)
        .slice(-MAX_HISTORY_ITEMS);

    let totalLength = 0;
    return trimmedHistory.filter((msg) => {
        if (totalLength + msg.content.length > MAX_HISTORY_CONTENT_LENGTH) {
            return false;
        }
        totalLength += msg.content.length;
        return true;
    });
};


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
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            return NextResponse.json(
                { error: 'Service temporarily unavailable', code: 'CONFIGURATION_ERROR' },
                { status: 503 }
            );
        }

        const clientIp = getClientIp(req);
        if (isRateLimited(clientIp)) {
            return NextResponse.json(
                { error: 'Too many requests', code: 'RATE_LIMITED' },
                { status: 429 }
            );
        }

        const body = await req.json();
        const message = typeof body?.message === 'string' ? body.message.trim() : '';
        const history = sanitizeHistory(body?.history);

        // Input validation (fail fast)
        if (!message) {
            return NextResponse.json(
                { error: 'Invalid request', code: 'VALIDATION_ERROR', details: 'Message is required' },
                { status: 400 }
            );
        }

        if (message.length > MAX_MESSAGE_LENGTH) {
            return NextResponse.json(
                {
                    error: 'Invalid request',
                    code: 'VALIDATION_ERROR',
                    details: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
                },
                { status: 400 }
            );
        }


        // 1. Get Metadata (Cached)
        let metadata = cache.get('gcs_metadata');
        if (!metadata) {
            console.log("Fetching fresh GCS metadata...");
            // Run GCS calls in parallel to save time
            const [filesRepo, guideContent, zipcodesContent, useCasesContent] = await Promise.all([
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
                })(),
                (async () => {
                    try {
                        const localPath = path.join(process.cwd(), 'src/data/use_cases.json');
                        if (fs.existsSync(localPath)) {
                            return fs.readFileSync(localPath, 'utf-8');
                        }
                        return "[]";
                    } catch (err) {
                        console.warn('Failed to load use_cases.json:', err);
                        return "[]";
                    }
                })()
            ]);

            metadata = {
                fileList: filesRepo[0].map((f: any) => f.name).join('\n'),
                files: filesRepo[0],
                productGuide: guideContent,
                zipcodes: zipcodesContent,
                useCases: useCasesContent
            };

            // Local fallback for product guide if GCS is empty
            if (!metadata.productGuide) {
                try {
                    const localPath = path.join(process.cwd(), 'product_guide_harvested.txt');
                    if (fs.existsSync(localPath)) {
                        metadata.productGuide = fs.readFileSync(localPath, 'utf-8');
                        console.log("Using local product_guide_fallback (harvested).");
                    }
                } catch (e) {
                    console.warn("Local guide fallback failed:", e);
                }
            }

            console.log(`Metadata loaded. Guide length: ${metadata.productGuide?.length || 0}. Use Cases: ${JSON.parse(metadata.useCases || "[]").length}`);
            cache.set('gcs_metadata', metadata);
        }

        const { fileList, files, productGuide, zipcodes, useCases } = metadata;
        const premiumKeys = Object.keys(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/product_metadata.json'), 'utf-8'))).join(', ');

        // 2. Step 1: Identify Relevant File
        const recentHistory = history.slice(-6).map((h: any) => `${h.role}: ${h.content}`).join('\n');
        const selectionPrompt = `
      You are the "Master Librarian" for United Formulas. 
      Your job is to pick the BEST file or knowledge source to answer the user's question.

      RECENT CONTEXT:
      ${recentHistory}

      USER QUESTION: "${message}"

      PREMIUM PRODUCTS (Use these names if mentioned):
      ${premiumKeys}

      PRODUCT GUIDE (MAPPING names to technical files):
      ${productGuide}

      DIRECT USE-CASE SOLUTIONS:
      ${useCases}

      AVAILABLE FILES:
      ${fileList}

      SELECTION RULES:
      1. DELIVERY/ORDERING: If the user asks about delivery, ordering, shipping, or receiving more of a product (even if misspelled like "delever"), RETURN "DELIVERY".
      2. USE-CASE MATCH: If the user describes a problem (e.g. "wine stains", "grease"), check DIRECT USE-CASE SOLUTIONS. If a match is found, RETURN "USECARE".
      3. SEARCH & TYPOS: If the user is searching for a category, chemical, or use-case, RETURN "GUIDE".
      4. DIRECT MATCH: If a product name is mentioned (e.g. "Nugget Car Wash", "Ace", "Delta Green"), pick its grounding file.
      5. PRONOUNS: Resolve "it", "this", "that" to the previous context.
      6. CLARIFY: Only return "CLARIFY" if they ask a technical/safety question ("Is it toxic?") but no product name has been mentioned yet.
      7. RETURN ONLY THE FILENAME or "USECARE" or "GUIDE" or "DELIVERY" or "CLARIFY" or "NONE" or "GENERAL".
    `;

        // Safety Catch-all for Category Searches (Fuzzy Support)
        const qLower = message.toLowerCase();
        const categoryKeywords = ['wash', 'cleaner', 'clner', 'wassh', 'soap', 'detergent', 'degreas', 'acid', 'caustic', 'sanitiz', 'mop', 'wax', 'polish', 'dish', 'stain', 'remove', 'solution', 'floor', 'gym'];
        const isLikelySearch = categoryKeywords.some(k => qLower.includes(k));

        let selectedFile = "";
        const selectionResult = await modelFlash.generateContent(selectionPrompt);
        selectedFile = selectionResult.response.text().trim();

        // If Gemini didn't pick something specific but it's a general keyword search, fallback to GUIDE
        if (isLikelySearch && !['USECARE', 'DELIVERY', 'CLARIFY'].includes(selectedFile.toUpperCase())) {
            console.log("Category keyword detected and no specific match, focusing on GUIDE.");
            selectedFile = "GUIDE";
        }

        // Robust cleanup: find the FIRST occurrence of a valid keyword
        const keywords = ['USECARE', 'GUIDE', 'DELIVERY', 'CLARIFY', 'NONE', 'GENERAL'];
        const upperSelected = selectedFile.toUpperCase();
        for (const kw of keywords) {
            if (upperSelected.includes(kw)) {
                selectedFile = kw;
                break;
            }
        }

        // Final fallback cleanup for filenames (remove markdown/quotes)
        selectedFile = selectedFile.replace(/```(?:\w+)?/g, '').replace(/['"`]/g, '').split('\n')[0].trim();

        // Final validation: Is it a keyword or a real file?
        const isKnownKeyword = keywords.includes(selectedFile);
        const isRealFile = fileList.includes(selectedFile);

        if (!isKnownKeyword && !isRealFile) {
            // If it's a long sentence, it's definitely not a match
            if (selectedFile.length > 100 || selectedFile.includes(' ')) {
                console.log(`Gemini was too chatty or missed: "${selectedFile}". Falling back to NONE.`);
                selectedFile = isLikelySearch ? "GUIDE" : "NONE";
            }
        }

        console.log(`Final Selected Context: ${selectedFile}`);

        let contextData = "No specific technical record found. Answer based on general knowledge or ask for clarification if a product is needed.";

        // 3. Step 2: Retrieve & Parse Content
        if (selectedFile === 'CLARIFY') {
            contextData = "STATUS: NO PRODUCT NAMED. You MUST ask which product they are referring to before providing safety or technical details. Do not guess the product.";
        } else if (selectedFile === 'USECARE') {
            contextData = `STATUS: PROBLEM SOLVED. Use Case Mappings:\n${useCases}\n\nProvide the specific solution listed for the matching problem. Acknowledge the problem directly.`;
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

            // Load Premium Metadata (Marketing/Canonical Descriptions)
            let metadata: any = {};
            try {
                const metadataPath = path.join(process.cwd(), 'src/data/product_metadata.json');
                if (fs.existsSync(metadataPath)) {
                    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                }
            } catch (err) {
                console.error("Error loading product metadata:", err);
            }

            // Find match in metadata (including variants)
            let premiumMatch: any = null;
            // Improved Slug Logic:
            // 1. Clean up file extensions and prefixes
            // 2. Normalize spaces to hyphens for matching
            // 3. Handle cases where the filename is "Delta Green" (spaces) vs "delta-green" (hyphens)
            const cleanName = selectedFile.split('/').pop()?.replace(/grounding__|sku_master__|.txt|.pdf/g, '') || "";
            // Normalize underscores to hyphens for matching with metadata keys
            const fileKey = cleanName.toLowerCase().replace(/_/g, '-').split('__')[0].trim().replace(/\s+/g, '-');

            console.log(`Searching metadata for slug: ${fileKey} (from file: ${selectedFile})`);

            for (const [key, details] of Object.entries(metadata) as [string, any]) {
                const normalizedKey = key.toLowerCase().replace(/_/g, '-');

                // Direct match OR Variant match OR Partial match
                if (normalizedKey === fileKey ||
                    (details.variants && details.variants.some((v: string) => v.toLowerCase().replace(/_/g, '-') === fileKey)) ||
                    fileKey.startsWith(normalizedKey) ||
                    normalizedKey.startsWith(fileKey)
                ) {
                    premiumMatch = details;
                    console.log(`Match found: ${key}`);
                    break;
                }
            }

            let technicalRecord = "";
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
                        technicalRecord = pdfText.slice(0, 30000);
                    } else {
                        technicalRecord = fileBuffer.toString();
                    }
                }
            } catch (err) {
                console.error("Error reading file:", err);
                technicalRecord = "Technical record could not be loaded.";
            }

            // Extract variants/sizes for context
            const variantList = premiumMatch?.variants ? premiumMatch.variants.join(', ') : "No specific size info in metadata.";

            contextData = `STATUS: PRODUCT IDENTIFIED.
            
            PREMIUM BRANDED DATA (MANDATORY FOR OVERVIEW):
            - Product Name: ${premiumMatch?.displayName || selectedFile}
            - Category: ${premiumMatch?.category || "Industrial Cleaner"}
            - Official Description: ${premiumMatch?.canonicalDescription || "I am currently retrieving the full branded details for this product. See the technical safety data below for immediate guidance."}
            - VARIANTS / SIZES: ${variantList} (If user asks about sizes, LIST THESE EXACTLY)
            
            TECHNICAL RECORD (SDS/TECHNICAL DATA):
            ${technicalRecord}`;
        }

        // 4. Step 3: Generate Answer
        const systemInstruction = `
      GOVERNING CONSTITUTION:
      Your primary responsibility is safety, accuracy, and integrity — not speed, confidence, or conversion.
      You are Dr. Aris, the friendly, professional, and safety-obsessed lead chemical expert for United Formulas.

      ────────────────────────────────
      SOURCE OF TRUTH HIERARCHY
      ────────────────────────────────
      1. PREMIUM BRANDED DATA (Use Official Description verbatim for "What is this?" questions)
      2. Product technical records (SDS/Labels)
      3. Company policy
      4. This governance framework

      ────────────────────────────────
      OPERATIONAL CLARIFICATION RULES:
      ────────────────────────────────
      1. FIRST AID & MEDICAL DISCLAIMER (STRICT): If (and ONLY IF) the user explicitly asks about first aid, exposure, or medical treatment, you MUST start your response with this EXACT sentence: "I am not a medical provider and cannot give medical advice, but here are the first aid instructions directly from our Safety Data Sheet (SDS) for this chemical:"
      2. PROHIBITION: Do NOT include first aid instructions, medical disclaimers, or any "NOTE: In a medical emergency..." text unless specifically requested for safety guidance. Do not repeat the 911 emergency note in general conversation.
      3. GENERAL PRODUCT INFO: If asked "Tell me about [Product]", provide a concise, one-sentence high-level overview.
      4. DIRECTNESS: Provide technical answers immediately. Do NOT ask "Are you referring to..." if they named the product.
      5. STATUS: NO PRODUCT NAMED: 
         - If the user asked a general question (e.g. "how do I clean floors?"), ask expert follow-up questions to help them choose the right product. (e.g. "What type of floor are you cleaning—wood, tile, or rubber?")
         - Otherwise, ask: "Which United Formulas product are you using or considering?"
      6. STATUS: PRODUCT IDENTIFIED (TECHNICAL): Use the retrieved technical data to provide professional, precise guidance.

      ────────────────────────────────
      DELIVERY & LOGISTICS:
      ────────────────────────────────
      - If the user asks for delivery, shipping, or "more" of a product:
        1. Ask for their City or Zip Code if you don't have it.
        2. Check the provided ZIPCODES list.
        3. IF FOUND: Confirm we deliver there and suggest contacting the local rep.
        4. IF NOT FOUND: Politely state we may not deliver directly there but to check with support.

      ────────────────────────────────
      LEAD GENERATION & ETIQUETTE:
      ────────────────────────────────
      1. NAME CAPTURE (AFTER 2-3 MESSAGES): If the user has not introduced themselves, politely ask for their name. (e.g. "By the way, I'd love to know who I'm speaking with. May I ask your name?")
      2. EMAIL & CATALOGUE OFFER: Subsequent to name capture, or after 4-5 messages total, offer to send our "Complete Product Catalogue." Ask for their email address to send it. (e.g. "I'd love to send you our full product catalogue for your records. What is the best email address to send that to?")
      3. ADDRESSING THE USER: Use their name naturally in responses ONLY if they have explicitly provided it in the chat history.
      4. STRICT PROHIBITION: NEVER guess, assume, or invent a name. You must only use a name if the user has explicitly stated it to you in THIS conversation.

      RETRIEVED DATA FOR YOUR USE (DO NOT MENTION SOURCE):
      ${contextData}

      CURRENT CONVERSATION LENGTH: ${history.length} messages.
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
        return NextResponse.json(
            { error: 'Chat request failed', code: 'INTERNAL_ERROR', details: 'Unexpected server error' },
            { status: 500 }
        );
    }

}

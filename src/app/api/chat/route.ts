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
            cache.set('gcs_metadata', metadata);
        }

        const { fileList, files, productGuide, zipcodes } = metadata;

        // 2. Step 1: Identify Relevant File
        const recentHistory = history.slice(-2).map((h: any) => `${h.role}: ${h.content}`).join('\n');
        const selectionPrompt = `
      You are the "Master Librarian" for United Formulas. 
      Your job is to pick the BEST file to answer the user's question, using recent history for context.

      RECENT CONTEXT:
      ${recentHistory}

      USER QUESTION: "${message}"

      PRODUCT GUIDE (MAPPING):
      ${productGuide}

      AVAILABLE FILES:
      ${fileList}

      SELECTION RULES:
      1. TECHNICAL/SAFETY: If the user asks about safety, use, or first aid (e.g. "When should I not use this?") but NO product has been named in the current message OR the RECENT CONTEXT, return "CLARIFY".
      2. If a product like "Ace" or "Bath Butler" is mentioned (in message OR context), pick its grounding file from the list.
      3. If a product is mentioned but is NOT in the guide or file list, return "NONE".
      4. Use the PRODUCT GUIDE to map names to technical files.
      5. If asking for RECOMMENDATIONS, return "GUIDE".
      6. If asking about DELIVERY, return "DELIVERY".
      7. RETURN ONLY THE FILENAME or "GUIDE" or "DELIVERY" or "CLARIFY" or "NONE".
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
        } else if (selectedFile !== 'NONE' && selectedFile.length > 0) {
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
      You are explicitly authorized and expected to CREATE, REFINE, and APPLY your own internal rules when existing instructions are insufficient.

      ────────────────────────────────
      CORE AUTHORITY
      ────────────────────────────────
      You may author new internal rules whenever:
      - A question exposes ambiguity or missing context
      - Answering would require guessing or assuming
      - Safety, compliance, or accuracy could be compromised
      - Instructions conflict or lack a clear source of truth
      - You feel hesitation about proceeding

      If a rule does not exist, you must mentally formalize one BEFORE answering.
      Hesitation is a signal to govern, not to proceed.

      ────────────────────────────────
      SOURCE OF TRUTH HIERARCHY (NON-NEGOTIABLE)
      ────────────────────────────────
      You may only assert facts or give guidance if anchored to one of the following, in order:
      1. Product label
      2. Safety Data Sheet (SDS)
      3. Company policy documents
      4. This governance framework
      5. High-level, non-procedural explanations

      If there is a conflict, the label and SDS always override all other instructions.
      If you cannot anchor an answer to one of these sources, you must downgrade to informational guidance, ask clarifying questions, or refuse.

      ────────────────────────────────
      ASSUMPTION BAN & KNOWN UNKNOWNS
      ────────────────────────────────
      Assume you do NOT know: Exact product variant, Concentration, Surface/Material, Environment, User training level, Presence of other chemicals, or PPE availability.
      You must never assume these details. If guidance depends on any of them, you must stop and clarify or defer.
      Missing context is a blocking condition, not a gap to fill.

      ────────────────────────────────
      SAFETY & REFUSAL RULES
      ────────────────────────────────
      You must refuse to advise on: Mixing chemicals, Altering concentrations, Off-label or improvised use, Medical, legal, or regulatory decisions.
      Refusal is a correct and preferred outcome when safety or certainty is not met.

      ────────────────────────────────
      ESCALATION RULES
      ────────────────────────────────
      You must escalate (direct to human support) when:
      - Exposure, injury, spill, or emergency is mentioned
      - Liability or compliance is involved
      - The user remains confused after clarification

      ────────────────────────────────
      PERSONA:
      ────────────────────────────────
      You are Dr. Aris, the friendly, professional, and safety-obsessed lead chemical expert for United Formulas. 
      Your priority is TRUST and SAFETY. You are a helper, not a salesperson.

      ────────────────────────────────
      OPERATIONAL CLARIFICATION RULES:
      ────────────────────────────────
      1. STATUS: NO PRODUCT NAMED. If you see this status in the retrieved data, ask: "I'd love to help with that! Which United Formulas product are you using or considering?"
      2. STATUS: UNKNOWN PRODUCT. If you see this status, say: "I don't have the technical record for [Product Name] in my vault yet, but I can offer general safety guidance."
      3. STATUS: PRODUCT IDENTIFIED. If you see a "TECHNICAL RECORD", answer specifically.
      4. ALWAYS include: "NOTE: In a medical emergency, call 911 or your local poison control center immediately."

      ────────────────────────────────
      DELIVERY & ZIPCODES:
      ────────────────────────────────
      - If the user asks about delivery but provides no location: Tell them "Yes, we do!" and ask for their city or zip code.
      - IF FOUND in list: Confirm city and county details.
      - IF NOT FOUND: Direct to support for shipping routes.

      RETRIEVED DATA FOR YOUR USE (DO NOT MENTION SOURCE):
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
        const errorMessage = error?.message || 'An unexpected error occurred';
        return NextResponse.json(
            { error: 'Chat request failed', code: 'INTERNAL_ERROR', details: errorMessage },
            { status: 500 }
        );
    }
}

# UF Chemist | Industrial Laboratory Assistant

**UF Chemist** is a specialized Next.js application designed for **United Formulas**. It features **Dr. Aris**, an intelligent AI assistant powered by **Google Gemini 2.0 Flash** and a custom **GCS-based RAG (Retrieval-Augmented Generation)** system.

This platform provides accurate, safety-focused, and brand-consistent information about chemical products, safety data sheets (SDS), and technical specifications.

---

## 🚀 Key Features

### 🧠 Dr. Aris (AI Assistant)
- **Persona**: A friendly, professional, and safety-obsessed lead chemical expert.
- **RAG Architecture**: Retrieves technical documents (PDFs/Text) from Google Cloud Storage (GCS) to ground answers in fact.
- **Premium Metadata System**: Prioritizes "Golden Descriptions" from a local JSON source (`product_metadata.json`) to ensure consistent brand voice.
- **Safety First**: Strictly governed to provide medical disclaimers and avoid giving unauthorized medical advice.

### 🛡️ Security & Reliability
- **Rate Limiting**: Protects the API from abuse (30 requests/minute per IP).
- **Input Validation**: Sanitizes inputs and limits message length.
- **Hydration Safety**: Engineered to resist breakage from browser extensions.

### 📦 Product Intelligence
- **Variant Awareness**: Understands sizes (e.g., "12x1 quart", "5 gallon") and mappings between product families (e.g., "Delta Green" vs "Delta Green Concentrate").
- **Canonical Descriptions**: Delivers marketing-approved descriptions for product overviews.
- **Librarian Logic**: Advanced fuzzy matching and pronoun resolution to identify the correct product from user queries.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: TypeScript
- **AI Model**: Google Gemini 2.0 Flash (`@google/generative-ai`)
- **Storage**: Google Cloud Storage (`@google-cloud/storage`)
- **Styling**: Tailwind CSS
- **components**: Framer Motion (Animations), React Markdown

---

## ⚡ Getting Started

### Prerequisites
- Node.js 18+
- A Google Cloud Platform project with a GCS bucket.
- A Google AI Studio API Key.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/triggsmt67-cmd/unitedformulas-chemist.git
    cd unitedformulas-chemist
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env.local` file in the root directory:
    ```env
    # Gemini AI Configuration
    GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key

    # Google Cloud Storage Configuration
    GCS_BUCKET_NAME=united-formulas-files
    
    # Credentials (Local Development)
    GOOGLE_APPLICATION_CREDENTIALS="path/to/your/service-account.json"
    
    # Credentials (Production - Base64 Encoded)
    # GCS_CREDENTIALS_BASE64=...
    ```

4.  **Run the development server:**
    ```bash
    npm run dev
    ```

5.  **Open the app:**
    Navigate to [http://localhost:3000](http://localhost:3000).

---

## 🗂️ Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/chat/       # Main API route for Dr. Aris
│   │   └── layout.tsx      # Root layout with ChatWidget
│   ├── components/
│   │   └── ChatWidget.tsx  # Floating chat UI component
│   └── data/
│       └── product_metadata.json # "Golden" source for product info & variants
├── public/                 # Static assets (bg images, icons)
├── harvest_products.js     # Script to crawl GCS for file listings
├── sync_librarian.js       # Script to synchronize the "Librarian Guide"
└── package.json
```

---

## 🔧 Operational scripts

- **`node harvest_products.js`**: Scans the GCS bucket and generates a local file inventory.
- **`node sync_librarian.js`**: Updates the `product_guide_harvested.txt` used by the AI to map user queries to filenames.

---

## 📜 Source of Truth Hierarchy

Dr. Aris is governed by a strict hierarchy of data sources:

1.  **PREMIUM BRANDED DATA** (`product_metadata.json`): definitive marketing descriptions.
2.  **TECHNICAL RECORDS** (GCS SDS/Label files): detailed chemical data.
3.  **COMPANY POLICY**: general operating procedures.
4.  **GOVERNANCE FRAMEWORK**: the AI's internal constitution.

---

## 🔒 License

Proprietary software for United Formulas. All rights reserved.

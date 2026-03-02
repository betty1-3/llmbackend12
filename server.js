import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in environment variables");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.1,
    responseMimeType: "application/json"
  }
});

// Allow all origins (secure later if needed)
app.use(cors());
app.use(express.json({ limit: '128kb' }));

// Health check
app.get("/", (req, res) => {
  res.send("✅ Gemini backend running");
});

// ===============================
// 🧠 Gemini Extraction Endpoint
// ===============================
app.post("/api/ask-llm", async (req, res) => {
  try {
    const { speech_input, field } = req.body;

    console.log("Incoming request:", req.body);

    if (!speech_input || !field) {
      return res.status(400).json({
        error: "Missing speech_input or field"
      });
    }

    let extractionInstruction = "";

    if (field === "location") {
      extractionInstruction = `
Extract:
- district
- state

If a city like "Nagpur" is mentioned with a state,
assume that city is also the district.

Return JSON:
{
  "district": string | null,
  "state": string | null
}
`;
    }

    if (field === "farm_size") {
      extractionInstruction = `
Extract:
- farm_size_acres (number)

Convert spoken numbers into decimals.

Return JSON:
{
  "farm_size_acres": number | null
}
`;
    }

    if (field === "crop_type") {
      extractionInstruction = `
Extract:
- crop_type (normalize to English like rice, wheat, maize, cotton)

Return JSON:
{
  "crop_type": string | null
}
`;
    }

    if (field === "sowing_date") {
      extractionInstruction = `
Extract:
- sowing_date in YYYY-MM-DD format

Convert informal phrases into proper date.

Return JSON:
{
  "sowing_date": string | null
}
`;
    }

    const prompt = `
You are a strict agricultural data extraction system.

The farmer may speak in:
English, Hindi, Odia, Tamil or mixed language.
Speech may contain spelling mistakes.

You must:
- Correct obvious spelling errors in district/state.
- Normalize crop names.
- Convert word numbers to numeric.
- Convert farm size to acres.
- Convert informal dates.
- Do NOT guess missing data.
- Return ONLY valid JSON.
- No explanation.
- No markdown.

${extractionInstruction}

Farmer speech:
"${speech_input}"
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log("Gemini JSON output:", text);

    let extracted;

    try {
      extracted = JSON.parse(text);
    } catch (parseError) {
      console.error("JSON parse failed:", text);
      return res.status(500).json({
        error: "Invalid JSON returned from Gemini",
        raw: text
      });
    }

    // 🔒 Validation Layer

    if (extracted.farm_size_acres !== undefined) {
      if (typeof extracted.farm_size_acres !== "number" || extracted.farm_size_acres <= 0) {
        extracted.farm_size_acres = null;
      }
    }

    if (extracted.sowing_date !== undefined && extracted.sowing_date !== null) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(extracted.sowing_date)) {
        extracted.sowing_date = null;
      }
    }

    return res.json(extracted);

  } catch (err) {
    console.error("❌ Gemini processing error:", err);
    return res.status(500).json({
      error: "Extraction failed",
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Gemini backend listening on port ${PORT}`);
});

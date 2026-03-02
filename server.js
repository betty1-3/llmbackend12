import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing in environment variables");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use safest compatible model
const model = genAI.getGenerativeModel({
  model: "gemini-pro"
});

app.use(cors());
app.use(express.json({ limit: "128kb" }));

// Health check route
app.get("/", (req, res) => {
  res.send("✅ Gemini backend running");
});

// ===============================
// 🧠 Extraction Endpoint
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

    switch (field) {
      case "location":
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
        break;

      case "farm_size":
        extractionInstruction = `
Extract:
- farm_size_acres (number)

Convert spoken numbers like "three", "teen", etc into numeric form.
Always return acres.

Return JSON:
{
  "farm_size_acres": number | null
}
`;
        break;

      case "crop_type":
        extractionInstruction = `
Extract:
- crop_type

Normalize to English crop name like:
rice, wheat, maize, cotton, sugarcane, etc.

Return JSON:
{
  "crop_type": string | null
}
`;
        break;

      case "sowing_date":
        extractionInstruction = `
Extract:
- sowing_date in YYYY-MM-DD format

Convert informal phrases like:
"June ke beech"
"last week"
"kharif season"

Return JSON:
{
  "sowing_date": string | null
}
`;
        break;

      default:
        return res.status(400).json({
          error: "Invalid field type"
        });
    }

    const prompt = `
You are a strict agricultural data extraction system.

The farmer may speak in:
English, Hindi, Odia, Tamil or mixed language.

Speech may contain spelling mistakes.

You must:
- Correct obvious spelling errors.
- Normalize crop names.
- Convert word numbers to numeric.
- Convert informal dates.
- Do NOT guess missing information.
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

    console.log("Gemini raw output:", text);

    // Extract JSON block safely
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.error("No JSON found in Gemini response");
      return res.status(500).json({
        error: "No JSON found",
        raw: text
      });
    }

    let extracted;

    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("JSON parse failed:", jsonMatch[0]);
      return res.status(500).json({
        error: "JSON parse failed",
        raw: text
      });
    }

    // 🔒 Basic Validation Layer

    if (extracted.farm_size_acres !== undefined) {
      if (
        typeof extracted.farm_size_acres !== "number" ||
        extracted.farm_size_acres <= 0
      ) {
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

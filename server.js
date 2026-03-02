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
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

app.use(cors());
app.use(express.json({ limit: "128kb" }));

// Health check
app.get("/", (req, res) => {
  res.send("✅ Gemini backend running");
});

app.post("/api/ask-llm", async (req, res) => {
  try {
    const { speech_input, field } = req.body;

    console.log("Incoming request:", req.body);

    if (!speech_input || !field) {
      return res.status(400).json({
        error: "Missing speech_input or field",
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

Return strictly valid JSON:
{
  "district": string | null,
  "state": string | null
}
`;
        break;

      case "land_area":
        extractionInstruction = `
Extract:
- land_area (number)

Convert spoken numbers like "teen", "three", etc into numeric form.
Always return value in acres.

Return strictly valid JSON:
{
  "land_area": number | null
}
`;
        break;

      case "crop":
        extractionInstruction = `
Extract:
- crop

Normalize crop name to English (rice, wheat, maize, cotton, etc).

Return strictly valid JSON:
{
  "crop": string | null
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

Return strictly valid JSON:
{
  "sowing_date": string | null
}
`;
        break;

      default:
        return res.status(400).json({
          error: "Invalid field type",
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

    console.log("Gemini raw output:", text);

    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return res.status(500).json({
        error: "No JSON found in Gemini response",
        raw: text,
      });
    }

    let extracted;

    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      return res.status(500).json({
        error: "JSON parse failed",
        raw: text,
      });
    }

    // Validation
    if (extracted.land_area !== undefined) {
      if (
        typeof extracted.land_area !== "number" ||
        extracted.land_area <= 0
      ) {
        extracted.land_area = null;
      }
    }

    if (extracted.sowing_date !== undefined && extracted.sowing_date !== null) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(extracted.sowing_date)) {
        extracted.sowing_date = null;
      }
    }

    // ✅ Add today's date as end_date
    const today = new Date().toISOString().split("T")[0];
    extracted.end_date = today;

    return res.json(extracted);

  } catch (err) {
    console.error("❌ Gemini processing error:", err);
    return res.status(500).json({
      error: "Extraction failed",
      details: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Gemini backend listening on port ${PORT}`);
});

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_KEY) {
  console.error('❌ Missing GEMINI_API_KEY in environment');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.1
  }
});

// ✅ Allow frontend
app.use(cors({ origin: 'https://aichatbot-inky-sigma.vercel.app' }));
app.use(express.json({ limit: '128kb' }));

// ===============================
// 🧠 Gemini Extraction Route
// ===============================
app.post('/api/ask-llm', async (req, res) => {
  try {
    const { speech_input, field } = req.body;

    if (!speech_input || !field) {
      return res.status(400).json({ error: 'Missing speech_input or field' });
    }

    let extractionInstruction = "";

    if (field === "location") {
      extractionInstruction = `
Extract:
- district
- state

Return:
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

Return:
{
  "farm_size_acres": number | null
}
`;
    }

    if (field === "crop_type") {
      extractionInstruction = `
Extract:
- crop_type (normalize to English like rice, wheat, maize, cotton)

Return:
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

Return:
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
    let text = response.text();

    text = text.replace(/```json|```/g, '').trim();

    const extracted = JSON.parse(text);

    // 🔒 Safety Validation Layer
    if (extracted.farm_size_acres !== undefined) {
      if (typeof extracted.farm_size_acres !== "number" || extracted.farm_size_acres <= 0) {
        extracted.farm_size_acres = null;
      }
    }

    if (extracted.sowing_date !== undefined) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(extracted.sowing_date)) {
        extracted.sowing_date = null;
      }
    }

    return res.json(extracted);

  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'Extraction failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Gemini backend listening on port ${PORT}`);
});

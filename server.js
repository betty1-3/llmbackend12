import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const HF_TOKEN = process.env.HF_TOKEN;
const MODEL = 'MiniMaxAI/SynLogic-Mix-3-32B';

if (!HF_TOKEN) {
  console.error('❌ Missing HF_TOKEN in environment');
  process.exit(1);
}

// ✅ Allow requests only from your frontend (Vercel app)
app.use(cors({ origin: 'https://aichatbot1-swart.vercel.app/' }));
app.use(express.json({ limit: '128kb' }));

// ===============================
// 🧠 Unified LLM Route
// Handles both normal queries and validation queries
// ===============================
app.post('/api/ask-llm', async (req, res) => {
  try {
    const { prompt, validation = false, max_tokens = 512 } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid prompt' });
    }

    // 🧹 Clean & prepare payload
    const payload = {
      inputs: prompt,
      parameters: { max_new_tokens: max_tokens },
    };

    // 🧠 Send to Hugging Face model
    const hfResponse = await fetch(
      `https://api-inference.huggingface.co/models/${MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!hfResponse.ok) {
      const txt = await hfResponse.text();
      console.error('Hugging Face error:', hfResponse.status, txt);
      return res.status(502).json({
        error: 'Model inference failed',
        details: txt,
      });
    }

    const result = await hfResponse.json();

    // 🧩 If this request is for validation
    if (validation) {
      // Try to interpret the model’s text
      const rawText =
        Array.isArray(result) && result[0]?.generated_text
          ? result[0].generated_text.toLowerCase()
          : JSON.stringify(result).toLowerCase();

      // Determine true/false from the model output
      const valid =
        rawText.includes('yes') ||
        rawText.includes('valid') ||
        rawText.includes('correct');

      return res.json({
        valid,
        raw: rawText,
      });
    }

    // 🧩 Otherwise, just return normal inference result
    return res.json(result);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ LLM backend listening on port ${PORT}`);
});


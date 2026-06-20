require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const Groq = require("groq-sdk");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    console.log("📨 Message:", message);

    // Format history for Groq
    const messages = (history || []).map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: h.parts?.[0]?.text || h.content || ''
    }));

    messages.push({
      role: 'user',
      content: message
    });

    const response = await groq.chat.completions.create({
      messages: messages,
     model: "llama-3.3-70b-versatile",
      max_tokens: 1024,
      temperature: 0.7,
    });

    const reply = response.choices[0].message.content;
    console.log("✅ Reply sent");
    res.json({ reply });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Nexus running");
});

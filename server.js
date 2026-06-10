require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const sessions = new Map();

function getSystemPrompt() {
  const skillPath = path.join(__dirname, 'skill.md');
  if (fs.existsSync(skillPath)) return fs.readFileSync(skillPath, 'utf8');
  return 'Sei un assistente vocale amichevole. Rispondi in modo conciso e naturale.';
}

async function callClaude(messages, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

async function callElevenLabs(text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${err}`);
  }
  const buffer = await res.buffer();
  return buffer.toString('base64');
}

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message?.trim()) return res.status(400).json({ error: 'Messaggio vuoto' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY mancante' });
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID)
    return res.status(500).json({ error: 'ElevenLabs non configurato' });

  try {
    const history = sessions.get(sessionId) || [];
    history.push({ role: 'user', content: message });

    const reply = await callClaude(history, getSystemPrompt());

    history.push({ role: 'assistant', content: reply });
    if (history.length > 40) history.splice(0, 2);
    sessions.set(sessionId, history);

    let audio = null;
    try {
      audio = await callElevenLabs(reply);
    } catch (e) {
      console.error('ElevenLabs error (testo comunque disponibile):', e.message);
    }

    res.json({ reply, audio });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  sessions.delete(sessionId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Companion → http://localhost:${PORT}`);
});

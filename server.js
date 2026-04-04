import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

let supabaseAdmin = null;
if (supabaseUrl && supabaseKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
} else {
  console.warn("⚠️ SUPABASE_SERVICE_KEY or URL missing! User syncing will fail.");
}

// -------------------------------------------------------------
// POST /api/users/sync
// Sync user from Firebase to Supabase database, updating profile
// -------------------------------------------------------------
app.post('/api/users/sync', async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase backend not configured.' });
  
  try {
    const { uid, email, name, photo, phone, age, gender, blood_group, weight, height, allergies, emergency_name, emergency_contact } = req.body;
    
    if (!uid) return res.status(400).json({ error: 'Missing firebase uid' });

    // Fetch existing user to determine if setup is needed
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('firebase_uid', uid)
      .single();

    let savedUser = existingUser;

    if (!existingUser) {
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert([{
          firebase_uid: uid, email, name: name || '', photo_url: photo || ''
        }])
        .select().single();
        
      if (insertError) throw insertError;
      return res.status(201).json({ user: newUser, isNewUser: true, hasCompletedSetup: false });
    }

    // Process Profile Setup Update (if demographic data is sent)
    if (age || blood_group || emergency_contact) {
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from('users')
        .update({
          name: name || existingUser.name,
          phone: phone || existingUser.phone,
          age: age || existingUser.age,
          gender: gender || existingUser.gender,
          blood_group: blood_group || existingUser.blood_group,
          weight: weight || existingUser.weight,
          height: height || existingUser.height,
          allergies: allergies || existingUser.allergies,
          emergency_name: emergency_name || existingUser.emergency_name,
          emergency_contact: emergency_contact || existingUser.emergency_contact
        })
        .eq('firebase_uid', uid)
        .select().single();
        
      if (updateError) throw updateError;
      savedUser = updatedUser;
    }

    const hasCompletedSetup = !!savedUser.age && !!savedUser.emergency_contact;
    res.json({ user: savedUser, isNewUser: false, hasCompletedSetup });

  } catch (err) {
    console.error("Sync user error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Initialize Gemini with API Key from .env or placeholder
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_API_KEY_HERE");

app.post('/api/scan', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Using Gemini 1.5 Flash for fast multimodal vision
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Analyze this image of a medicine, pill, or bottle.
    Identify the medicine and return exactly a JSON object matching this structure without any markdown formatting or backticks:
    {
      "name": "DrugName",
      "dosage": "500",
      "instructions": "Take after meals / Take with water / etc",
      "pillsRemaining": 12,
      "pharmacyDistance": "0.3 miles"
    }
    If you cannot fully identify it, make a safe generic guess matching the JSON structure. Do NOT wrap the output in \`\`\`json blocks.`;

    const imageParts = [
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg"
        }
      }
    ];

    const result = await model.generateContent([prompt, ...imageParts]);
    const responseText = result.response.text();
    
    // Clean up potential markdown blocks
    const cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    const data = JSON.parse(cleanJson);
    res.json(data);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({ error: 'Failed to analyze medicine. Make sure your GEMINI_API_KEY is correct.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Aarogya Xpress API running on http://localhost:${PORT}`);
});

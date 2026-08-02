import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const credPath = path.resolve(__dirname, '../.cred/test.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;

const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const projectId = serviceAccount.project_id;
const location = 'us-central1';
const apiKey = process.env.GEMINI_API_KEY;

const sampleText = "Hey, are you down to grab some pizza later? I'm starving!";
const systemInstruction = "Only output the translated text";
const prompt = `Translate the following text to German: ${sampleText}`;

const testModels = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

console.log(`=== EXTENDED GEMINI SDK TESTING ===\n`);

// TEST 1: Vertex AI Mode (enterprise: true) with Service Account
async function testVertexEnterprise() {
  console.log('--- TEST 1: Enterprise Mode (enterprise: true) with Service Account ---');
  const ai = new GoogleGenAI({
    enterprise: true,
    project: projectId,
    location: location,
  });

  for (const model of testModels) {
    try {
      const res = await ai.models.generateContent({
        model: model,
        config: { systemInstruction: systemInstruction },
        contents: prompt,
      });
      console.log(`✅ [Vertex Enterprise] ${model}: "${res.text?.trim()}"`);
    } catch (err: any) {
      const msg = err.message || JSON.stringify(err);
      console.log(`❌ [Vertex Enterprise] ${model}: ${msg.includes('was not found') ? '404 NOT_FOUND' : msg}`);
    }
  }
}

// TEST 2: Developer API Mode (enterprise: false) using Service Account Credentials / OAuth2 Bearer Token
async function testDevApiWithServiceAccountToken() {
  console.log('\n--- TEST 2: Developer API (enterprise: false) with Service Account OAuth2 Token ---');
  try {
    const auth = new GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/generative-language'],
    });
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();

    // Passing OAuth2 token as apiKey or headers
    const ai = new GoogleGenAI({
      apiKey: tokenRes.token || '',
    });

    for (const model of testModels) {
      try {
        const res = await ai.models.generateContent({
          model: model,
          config: { systemInstruction: systemInstruction },
          contents: prompt,
        });
        console.log(`✅ [DevAPI + OAuth2 Token] ${model}: "${res.text?.trim()}"`);
      } catch (err: any) {
        const msg = err.message || JSON.stringify(err);
        console.log(`❌ [DevAPI + OAuth2 Token] ${model}: ${msg.includes('API key not valid') ? 'INVALID_API_KEY (Developer API requires Google AI Studio API Key, not GCP OAuth2 token)' : msg}`);
      }
    }
  } catch (err: any) {
    console.log(`OAuth2 Token generation error: ${err.message}`);
  }
}

// TEST 3: Developer API Mode (enterprise: false) with AI Studio API Key
async function testDevApiWithApiKey() {
  console.log('\n--- TEST 3: Developer API (enterprise: false) with AI Studio API Key ---');
  if (!apiKey) {
    console.log('Skipped: GEMINI_API_KEY not found in .env');
    return;
  }
  const ai = new GoogleGenAI({ apiKey });

  for (const model of testModels) {
    try {
      const res = await ai.models.generateContent({
        model: model,
        config: { systemInstruction: systemInstruction },
        contents: prompt,
      });
      console.log(`✅ [DevAPI + API Key] ${model}: "${res.text?.trim()}"`);
    } catch (err: any) {
      const msg = err.message || JSON.stringify(err);
      console.log(`❌ [DevAPI + API Key] ${model}: ${msg.includes('was not found') ? '404 NOT_FOUND' : msg}`);
    }
  }
}

async function run() {
  await testVertexEnterprise();
  await testDevApiWithServiceAccountToken();
  await testDevApiWithApiKey();
  console.log('\n=== ALL TESTS FINISHED ===');
}

run();

import fs from 'fs';
import path from 'path';
import { GoogleAuth } from 'google-auth-library';
import { createGoogle } from '@ai-sdk/google';
import { generateText } from 'ai';

async function main() {
  console.log('=== PRUEBA ISLADA DE CREDENCIALES SERVICE ACCOUNT (.cred/test.json) ===\n');

  const credPath = path.resolve('.cred/test.json');
  if (!fs.existsSync(credPath)) {
    console.error(`❌ Archivo no encontrado en ${credPath}`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  console.log(`📌 Project ID: ${credentials.project_id}`);
  console.log(`📌 Client Email: ${credentials.client_email}`);

  // 1. Obtener Access Token
  console.log('\n🔑 1. Autenticando Service Account con google-auth-library...');
  const auth = new GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/generative-language',
      'https://www.googleapis.com/auth/cloud-platform',
    ],
  });

  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  const token = tokenRes.token;
  console.log('✅ Access Token obtenido exitosamente.');

  // 2. Probando API de Generative Language (generativelanguage.googleapis.com) con Bearer Token
  console.log('\n🌐 2. Probando API Generative Language (generativelanguage.googleapis.com)...');
  const genLangUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  try {
    const res = await fetch(genLangUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Di únicamente OK' }] }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log('🎉 ÉXITO con Generative Language API! Respuesta:', text?.trim());
    } else {
      const err = await res.text();
      console.warn(`⚠️ Generative Language API retornó HTTP ${res.status}:`, err.substring(0, 300));
    }
  } catch (err) {
    console.warn('⚠️ Error en request Generative Language API:', err.message);
  }

  // 3. Probando Vercel AI SDK (@ai-sdk/google) con custom fetch
  console.log('\n🚀 3. Probando Vercel AI SDK (@ai-sdk/google) con Interceptor de Bearer Token...');
  const googleProvider = createGoogle({
    apiKey: 'service-account-bearer', // string dummy para pasar validación estática
    fetch: async (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      headers.delete('x-goog-api-key'); // Reemplazar api key header por Bearer Token
      return fetch(url, { ...options, headers });
    },
  });

  const modelsToTest = ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'];
  for (const modelName of modelsToTest) {
    try {
      console.log(`\n⏳ Invocando Vercel AI SDK con modelo '${modelName}'...`);
      const response = await generateText({
        model: googleProvider(modelName),
        prompt: 'Responde únicamente con "OK".',
      });
      console.log(`🎉 ÉXITO Vercel AI SDK con '${modelName}'! Respuesta:`, response.text.trim());
    } catch (err) {
      console.warn(`⚠️ Fallo con modelo '${modelName}':`, err.message);
    }
  }

  // 4. Probando Vertex AI (us-central1 y global)
  console.log('\n🏛️ 4. Probando Vertex AI API (us-central1)...');
  const vertexUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${credentials.project_id}/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent`;
  try {
    const res = await fetch(vertexUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hola Vertex' }] }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log('🎉 ÉXITO con Vertex AI! Respuesta:', JSON.stringify(data).substring(0, 150));
    } else {
      const err = await res.text();
      console.warn(`⚠️ Vertex AI retornó HTTP ${res.status}:`, err.substring(0, 300));
    }
  } catch (err) {
    console.warn('⚠️ Error en Vertex AI:', err.message);
  }
}

main();

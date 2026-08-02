import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';
import { createGoogle } from '@ai-sdk/google';
import { generateText } from 'ai';

async function testLadyTrial() {
  console.log('=== PRUEBA EN VIVO: KEY BALANCER + LADY TRIAL SERVICE ACCOUNT ===\n');

  const kbUrl = 'http://localhost:3333/api/key-usage/get-best-key-balanced';
  const payload = {
    token: null,
    keyRequest: {
      provider: 'google',
      aiType: 'llm',
      service: 'gemini-2.5-flash',
      tierType: 'trial',
    },
  };

  console.log(`⚖️ 1. Solicitando clave 'trial' a Key Balancer (${kbUrl})...`);
  const kbRes = await fetch(kbUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!kbRes.ok) {
    console.error(`❌ Key Balancer retornó HTTP ${kbRes.status}: ${await kbRes.text()}`);
    return;
  }

  const balancedKey = await kbRes.json();
  console.log(`✅ Key Balancer respondió exitosamente!`);
  console.log(`   📌 Nombre: ${balancedKey.name}`);
  console.log(`   📌 KeyType: ${balancedKey.keyType}`);
  console.log(`   📌 TierType: ${balancedKey.tierType}`);
  console.log(`   📌 Provider: ${balancedKey.provider}`);

  if (balancedKey.keyType !== 'service_account') {
    console.warn('⚠️ La clave no es un service_account.');
    return;
  }

  const credentials = JSON.parse(balancedKey.key);
  console.log(`   📌 Project ID: ${credentials.project_id}`);
  console.log(`   📌 Client Email: ${credentials.client_email}`);

  // 2. Obtener Access Token OAuth2
  console.log('\n🔑 2. Autenticando Service Account con google-auth-library...');
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
  console.log('✅ Access Token OAuth2 obtenido exitosamente.');

  // 3. Probando con Vercel AI SDK (@ai-sdk/google - Generative Language API)
  console.log('\n🚀 3. Probando Vercel AI SDK (@ai-sdk/google) con Interceptor de Bearer Token...');
  const googleProvider = createGoogle({
    apiKey: 'service-account-bearer',
    fetch: async (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      headers.delete('x-goog-api-key');
      return fetch(url, { ...options, headers });
    },
  });

  try {
    const response = await generateText({
      model: googleProvider('gemini-2.5-flash'),
      prompt: 'Di exactamente: "Hola, soy Lady Trial funcionando mediante Service Account en Key Balancer!"',
    });
    console.log('\n🎉 ÉXITO TOTAL CON VERCEL AI SDK + KEY BALANCER!\nRespuesta:', response.text);
  } catch (err) {
    console.warn('⚠️ Error invocando modelo Gemini:', err.message);
  }

  // 5. Probando con Vercel AI SDK (@ai-sdk/google-vertex)
  console.log('\n🌟 5. Probando Vercel AI SDK NATIVO para Vertex AI (@ai-sdk/google-vertex)...');
  try {
    const { createVertex } = await import('@ai-sdk/google-vertex');
    const vertex = createVertex({
      project: credentials.project_id,
      location: 'us-central1',
      googleAuthOptions: { credentials },
    });

    const response = await generateText({
      model: vertex('gemini-2.5-flash'),
      prompt: 'Di exactamente: "Hola desde @ai-sdk/google-vertex funcionando perfectamente en Control Markets!"',
    });
    console.log('\n🎉🎉🎉 ÉXITO ROTUNDO CON @ai-sdk/google-vertex!\nRespuesta:', response.text);
  } catch (err) {
    console.warn('⚠️ Error en @ai-sdk/google-vertex:', err.message || err);
  }
}

testLadyTrial();


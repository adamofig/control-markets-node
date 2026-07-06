/**
 * Script de prueba de Web Push (FCM) — canal `webpush` de Control Markets.
 *
 * Envía una notificación push directamente por FCM (firebase-admin), saltándose
 * la API y la lógica de org, para probar el camino real servidor → dispositivo.
 *
 * Uso (desde control-markets-node/):
 *   pnpm exec node scripts/test-push.mjs                      # global: a TODOS los dispositivos registrados
 *   pnpm exec node scripts/test-push.mjs "Hola equipo!"      # global con mensaje custom
 *   pnpm exec node scripts/test-push.mjs --user <fbId> "Hola" # solo a un usuario
 *   pnpm exec node scripts/test-push.mjs --list              # solo listar suscripciones, no enviar
 *   pnpm exec node scripts/test-push.mjs --clean "Hola"      # además borra tokens muertos de la DB
 *
 * Requisitos: MONGODB_URI y GOOGLE_APPLICATION_CREDENTIALS en .env (ya presentes).
 */
import { MongoClient } from 'mongodb';
import admin from 'firebase-admin';
import { applicationDefault } from 'firebase-admin/app';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// --- parseo de argumentos ---
const args = process.argv.slice(2);
const flags = { list: args.includes('--list'), clean: args.includes('--clean') };
let targetUser = null;
const userIdx = args.indexOf('--user');
if (userIdx !== -1) targetUser = args[userIdx + 1];
const message =
  args.filter((a, i) => !a.startsWith('--') && i !== userIdx + 1).join(' ') ||
  `🔔 Prueba de Control Markets — ${new Date().toLocaleTimeString('es-MX')}`;

function log(...a) { console.log(...a); }

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('❌ Falta MONGODB_URI en .env'); process.exit(1); }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('❌ Falta GOOGLE_APPLICATION_CREDENTIALS en .env'); process.exit(1);
  }

  admin.initializeApp({ credential: applicationDefault() });

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const query = { channel: 'webpush', status: 'verified' };
  if (targetUser) query.userId = targetUser;
  const identities = await db.collection('channel_identities').find(query).toArray();

  log(`\n📋 Suscripciones webpush encontradas: ${identities.length}${targetUser ? ` (usuario ${targetUser})` : ' (GLOBAL, todas las orgs)'}`);
  for (const i of identities) {
    log(`   • user=${i.userId}  org=${i.orgId}  plat=${i.metadata?.platform || '?'}  token=${String(i.address).slice(0, 16)}…`);
  }

  if (flags.list) { await client.close(); return; }
  if (!identities.length) { log('\n⚠️  No hay dispositivos suscritos. Activa las notificaciones en /page/test-messaging primero.'); await client.close(); return; }

  const tokens = identities.map(i => i.address).filter(Boolean);
  log(`\n🚀 Enviando: "${message}"  → ${tokens.length} dispositivo(s)…`);

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: 'Control Markets', body: message },
    data: { url: '/page/test-messaging' },
    webpush: {
      notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' },
      fcmOptions: { link: '/page/test-messaging' },
    },
  });

  log(`\n✅ Éxitos: ${res.successCount}   ❌ Fallos: ${res.failureCount}`);
  const deadTokens = [];
  res.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = r.error?.code || 'unknown';
      log(`   ❌ token ${String(tokens[idx]).slice(0, 16)}… → ${code}`);
      if (code === 'messaging/registration-token-not-registered') deadTokens.push(tokens[idx]);
    }
  });

  if (deadTokens.length && flags.clean) {
    const del = await db.collection('channel_identities').deleteMany({ channel: 'webpush', address: { $in: deadTokens } });
    log(`\n🧹 Limpieza: ${del.deletedCount} suscripción(es) muerta(s) eliminada(s).`);
  } else if (deadTokens.length) {
    log(`\nℹ️  ${deadTokens.length} token(s) muerto(s). Corre con --clean para borrarlos de la DB.`);
  }

  await client.close();
  log('\n🏁 Listo.');
}

main().catch(e => { console.error('💥', e.message); process.exit(1); });

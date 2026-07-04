import { runBot } from './tiktok-bot-v2';

const profileName = process.argv[2];

if (!profileName) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: Debes especificar el nombre del perfil de Chrome.');
  console.error('Uso: pnpm ts-node src/tiktok-bot/runner.ts "<nombre_del_perfil>"');
  console.error('Ejemplos:');
  console.error('  pnpm ts-node src/tiktok-bot/runner.ts "Default"');
  console.error('  pnpm ts-node src/tiktok-bot/runner.ts "Profile 14"');
  process.exit(1);
}

console.log(`\x1b[32m%s\x1b[0m`, `🚀 Iniciando TikTok bot usando el perfil de Chrome: "${profileName}"`);

runBot(profileName)
  .then(() => {
    console.log('🤖 El bot ha finalizado su ejecución.');
  })
  .catch((error) => {
    console.error('❌ Error crítico durante la ejecución del bot:', error);
  });

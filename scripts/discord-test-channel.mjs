import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`Bot logged in as: ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();

  console.log('Channels:', channels.map(c => `${c.name} (${c.id})`).join('\n'));

  const testChannel = channels.find(c => c.name === 'test');
  if (!testChannel) {
    console.error('Channel "test" not found.');
    client.destroy();
    return;
  }

  await testChannel.send('🤖 Control Markets Bot is online and posting in **#test**. Discord integration working ✅');
  console.log(`Posted to #${testChannel.name} (${testChannel.id})`);
  client.destroy();
});

client.login(TOKEN);

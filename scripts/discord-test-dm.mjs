import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID || '1505740204781080656';
const USERNAME_TO_FIND = process.env.DISCORD_TEST_USERNAME || 'adamofig';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('clientReady', async () => {
  console.log(`Bot logged in as: ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch(); // load all members

    const member = guild.members.cache.find(
      m => m.user.username.toLowerCase() === USERNAME_TO_FIND.toLowerCase()
    );

    if (!member) {
      console.error(`User "${USERNAME_TO_FIND}" not found in guild.`);
      console.log('Members in guild:', guild.members.cache.map(m => m.user.username));
      client.destroy();
      return;
    }

    console.log(`Found user: ${member.user.tag} (ID: ${member.user.id})`);

    const dm = await member.user.createDM();
    await dm.send('👋 Hola Adamo! Control Markets bot is online. This is a test DM — the Discord integration is working ✅');

    console.log('DM sent successfully!');
  } catch (err) {
    console.error('Error:', err.message);
  }

  client.destroy();
});

client.login(TOKEN);

import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function main() {
  try {
    await client.login(process.env.DISCORD_TOKEN);

    const threadId = process.argv[2];
    if (!threadId) {
      console.log('Usage: node check-thread.mjs <threadId>');
      process.exit(1);
    }

    try {
      const channel = await client.channels.fetch(threadId);
      console.log(JSON.stringify({
        exists: true,
        type: channel.type,
        archived: channel.archived,
        locked: channel.locked,
        name: channel.name
      }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({
        exists: false,
        error: err.message,
        code: err.code
      }, null, 2));
    }
  } finally {
    await client.destroy();
  }
}

main().catch(console.error);

/**
 * Check bot's server-level permissions
 * USAGE: tsx scripts/check-bot-permissions.ts <guildId>
 */

import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';

async function main() {
  const guildId = process.argv[2] || '896070888594759740'; // Default to Pawtropolis

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ ERROR: DISCORD_TOKEN not found in environment');
    process.exit(1);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once('ready', async () => {
    console.log(`✅ Bot connected as ${client.user?.tag}\n`);

    try {
      const guild = await client.guilds.fetch(guildId);
      console.log(`📋 Guild: ${guild.name}\n`);

      const botMember = await guild.members.fetchMe();
      const permissions = botMember.permissions;

      console.log('🔑 Server-Level Permissions:\n');

      const criticalPerms = [
        'Administrator',
        'ManageGuild',
        'ManageChannels',
        'ManageRoles',
        'ViewChannel',
        'ReadMessageHistory',
        'SendMessages',
        'ManageMessages',
        'EmbedLinks',
        'AttachFiles',
      ];

      for (const perm of criticalPerms) {
        const has = permissions.has(PermissionFlagsBits[perm as keyof typeof PermissionFlagsBits]);
        console.log(`  ${has ? '✅' : '❌'} ${perm}`);
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (permissions.has(PermissionFlagsBits.Administrator)) {
        console.log('🔓 Bot HAS Administrator permission');
        console.log('   Bot can theoretically modify any channel permissions');
        console.log('   However, doing so automatically would be bad practice\n');
      } else if (permissions.has(PermissionFlagsBits.ManageChannels)) {
        console.log('🔧 Bot HAS ManageChannels permission');
        console.log('   Bot can modify channel permissions it has access to');
        console.log('   Cannot modify channels it cannot view\n');
      } else {
        console.log('🔒 Bot DOES NOT have permission management capabilities');
        console.log('   Cannot modify channel permissions\n');
      }

      console.log('📝 Bot Roles:');
      botMember.roles.cache.forEach(role => {
        if (role.name !== '@everyone') {
          console.log(`   - ${role.name} (${role.id})`);
        }
      });

      process.exit(0);
    } catch (err: any) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
  });

  console.log('🔌 Connecting to Discord...\n');
  await client.login(token);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

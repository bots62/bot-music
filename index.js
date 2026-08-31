const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    leaveOnEmpty: true,
    leaveOnFinish: false,
    plugins: [new YtDlpPlugin()]
});

const PANEL_CHANNEL_ID = '1543145775729746051';
const activeSessions = new Map();

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await sendOrUpdatePanel();
});

async function sendOrUpdatePanel() {
    try {
        const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('Music Bot')
            .setDescription('هنا تقدر تجيب بوت لرومك وتتحكم فيه');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('music_panel_menu')
            .setPlaceholder('Choose an order from the list')
            .addOptions([
                {
                    label: 'اضافة بوت الاغاني',
                    value: 'add_bot'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const messages = await channel.messages.fetch({ limit: 10 });
        const existing = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
        
        if (existing) {
            await existing.edit({ embeds: [embed], components: [row] }).catch(() => {});
        } else {
            await channel.send({ embeds: [embed], components: [row] });
        }
    } catch (err) {
        console.error('Error sending panel:', err);
    }
}

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'music_panel_menu') {
            const choice = interaction.values[0];
            const member = interaction.member;
            let voiceChannel = member?.voice?.channel;

            if (!voiceChannel && interaction.guild) {
                const guildMember = await interaction.guild.members.fetch(member.id).catch(() => null);
                voiceChannel = guildMember?.voice?.channel;
            }

            // إرجاع القائمة لحالتها الطبيعية فوراً لكي تستطيع الضغط عليها مراراً وتكراراً بدون تعليق الصح
            await interaction.update({ components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('music_panel_menu')
                        .setPlaceholder('Choose an order from the list')
                        .addOptions([{ label: 'اضافة بوت الاغاني', value: 'add_bot' }])
                )
            ] }).catch(() => {});

            if (choice === 'add_bot') {
                if (!voiceChannel) {
                    return interaction.followUp({ content: 'أنت لست في روم صوتي!', ephemeral: true });
                }

                try {
                    // إدخال البوت فعلياً للروم الصوتي عبر DisTube
                    await distube.voices.join(voiceChannel);

                    const controlEmbed = new EmbedBuilder()
                        .setColor('#18191c')
                        .setDescription('**تحكم ببوت الأغاني من هنا**');

                    const row1 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_search').setLabel('تشغيل أغنية').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('btn_pause_resume').setLabel('إيقاف/استئناف').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_stop').setLabel('إيقاف نهائي').setStyle(ButtonStyle.Danger)
                    );

                    const row2 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_allow').setLabel('صلاحية').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('btn_disallow').setLabel('إزالة صلاحية').setStyle(ButtonStyle.Secondary)
                    );

                    const controlMsg = await voiceChannel.send({
                        embeds: [controlEmbed],
                        components: [row1, row2]
                    });

                    // حذف رسالة التحكم تلقائياً بعد 5 دقائق
                    setTimeout(async () => {
                        try {
                            await controlMsg.delete().catch(() => {});
                        } catch (e) {}
                    }, 5 * 60 * 1000);

                    activeSessions.set(voiceChannel.id, {
                        ownerId: member.id,
                        allowedUsers: [member.id],
                        controlMsgId: controlMsg.id,
                        channelId: voiceChannel.id
                    });

                    await interaction.followUp({ content: 'تم إدخال البوت لرومك الصوتي بنجاح!', ephemeral: true });
                } catch (err) {
                    console.error(err);
                    await interaction.followUp({ content: 'حدث خطأ أثناء محاولة دخول الروم الصوتي.', ephemeral: true });
                }
            }
        }
    }

    if (interaction.isButton()) {
        const member = interaction.member;
        let voiceChannel = member?.voice?.channel;

        if (!voiceChannel && interaction.guild) {
            const guildMember = await interaction.guild.members.fetch(member.id).catch(() => null);
            voiceChannel = guildMember?.voice?.channel;
        }

        let session = voiceChannel ? activeSessions.get(voiceChannel.id) : null;
        if (!session) {
            for (const [chId, sess] of activeSessions.entries()) {
                const ch = interaction.guild.channels.cache.get(chId);
                if (ch && ch.members.has(member.id)) {
                    session = sess;
                    voiceChannel = ch;
                    break;
                }
            }
        }

        if (!session) {
            return interaction.reply({ content: 'البوت ليس موجوداً في رومك الصوتي!', ephemeral: true });
        }

        if (session.ownerId !== member.id && !session.allowedUsers.includes(member.id)) {
            return interaction.reply({ content: 'ما معك صلاحية', ephemeral: true });
        }

        const customId = interaction.customId;

        if (customId === 'btn_search') {
            const modal = new ModalBuilder()
                .setCustomId('search_song_modal')
                .setTitle('تشغيل اغنية');

            const songInput = new TextInputBuilder()
                .setCustomId('song_query')
                .setLabel('اكتب اسم الاغنية')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('مثال: شوفك شفا أريام')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(songInput));
            return await interaction.showModal(modal);
        }

        if (customId === 'btn_stop') {
            try {
                await distube.stop(voiceChannel);
                await distube.voices.leave(voiceChannel);
            } catch (e) {}
            activeSessions.delete(voiceChannel?.id);
            return interaction.reply({ content: `تم إيقاف البوت وإخراجه بواسطة <@${member.id}>`, ephemeral: true });
        }

        if (customId === 'btn_pause_resume') {
            try {
                const queue = distube.getQueue(voiceChannel);
                if (!queue) return interaction.reply({ content: 'لا توجد أغنية مشغلة حالياً', ephemeral: true });
                if (queue.paused) {
                    distube.resume(voiceChannel);
                    return interaction.reply({ content: 'تم استئناف الأغنية', ephemeral: true });
                } else {
                    distube.pause(voiceChannel);
                    return interaction.reply({ content: 'تم إيقاف الأغنية مؤقتاً', ephemeral: true });
                }
            } catch (e) {
                return interaction.reply({ content: 'حدث خطأ أثناء التحكم بالتشغيل', ephemeral: true });
            }
        }

        if (customId === 'btn_allow') {
            return interaction.reply({ content: 'منشن العضو لإعطائه الصلاحية.', ephemeral: true });
        }

        if (customId === 'btn_disallow') {
            return interaction.reply({ content: 'تم إزالة الصلاحية.', ephemeral: true });
        }
    }

    if (interaction.isModalSubmit()) {
        const member = interaction.member;
        let voiceChannel = member?.voice?.channel;

        if (!voiceChannel && interaction.guild) {
            const guildMember = await interaction.guild.members.fetch(member.id).catch(() => null);
            voiceChannel = guildMember?.voice?.channel;
        }

        let session = voiceChannel ? activeSessions.get(voiceChannel.id) : null;
        if (!session) {
            for (const [chId, sess] of activeSessions.entries()) {
                const ch = interaction.guild.channels.cache.get(chId);
                if (ch && ch.members.has(member.id)) {
                    session = sess;
                    voiceChannel = ch;
                    break;
                }
            }
        }

        if (!session || !voiceChannel) return;

        if (interaction.customId === 'search_song_modal') {
            const query = interaction.fields.getTextInputValue('song_query');

            await interaction.deferReply({ ephemeral: true });

            try {
                await distube.play(voiceChannel, query, {
                    textChannel: voiceChannel,
                    member: member
                });

                await interaction.editReply({ content: 'تم تشغيل الأغنية بنجاح في الفويس!' });
            } catch (err) {
                console.error(err);
                await interaction.editReply({ content: 'حدث خطأ أثناء تشغيل الأغنية. تأكد من صحة البحث.' });
            }
        }
    }
});

client.login(process.env.TOKEN);

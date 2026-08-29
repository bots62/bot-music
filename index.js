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
    TextInputStyle,
    ChannelType 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const play = require('play-dl');

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

const PANEL_CHANNEL_ID = '1543145775729746051';
const activeSessions = new Map();

const availableBots = [
    { id: client.user?.id || 'main', token: process.env.TOKEN }
];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await sendOrUpdatePanel();

    // التحديث التلقائي لرسائل الأزرار كل 5 دقائق (حذف وإعادة إرسال فورية)
    setInterval(async () => {
        for (const [channelId, session] of activeSessions.entries()) {
            try {
                const channel = await client.channels.fetch(session.channelId).catch(() => null);
                if (!channel) continue;

                if (session.controlMsgId) {
                    const oldMsg = await channel.messages.fetch(session.controlMsgId).catch(() => null);
                    if (oldMsg) await oldMsg.delete().catch(() => {});
                }

                const controlEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setDescription('تحكم ببوت الاغاني من هنا');

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('btn_search').setLabel('تشغيل اغنية').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('btn_stop').setLabel('ايقاف الاغنية').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('btn_vol').setLabel('رفع الصوت').setStyle(ButtonStyle.Secondary)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('btn_perm').setLabel('صلاحية').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('btn_remove_perm').setLabel('ازالة صلاحية').setStyle(ButtonStyle.Secondary)
                );

                const newMsg = await channel.send({
                    content: `مرحباً بك <@${session.ownerId}>`,
                    embeds: [controlEmbed],
                    components: [row1, row2]
                });

                session.controlMsgId = newMsg.id;
            } catch (err) {
                console.error('Error refreshing control message:', err);
            }
        }
    }, 5 * 60 * 1000);
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

        const messages = await channel.messages.fetch({ limit: 5 });
        const existing = messages.find(m => m.author.id === client.user.id);
        
        if (existing) {
            await existing.edit({ embeds: [embed], components: [row] });
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
            const voiceChannel = member?.voice?.channel;

            // إرجاع القائمة لوضعها الطبيعي فوراً
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

                // التحقق هل الروم يحتوي على بوت مضاف مسبقاً
                if (activeSessions.has(voiceChannel.id)) {
                    return interaction.followUp({ content: 'هذا الروم يحتوي على بوت مضاف مسبقاً!', ephemeral: true });
                }

                if (activeSessions.size >= availableBots.length) {
                    return interaction.followUp({ content: 'لا توجد بوتات كافية حالياً!', ephemeral: true });
                }

                try {
                    let targetTextChannel = null;
                    const guildChannels = await interaction.guild.channels.fetch();
                    
                    if (voiceChannel.parentId) {
                        targetTextChannel = guildChannels.find(c => c && c.parentId === voiceChannel.parentId && c.type === ChannelType.GuildText);
                    }
                    
                    if (!targetTextChannel) {
                        targetTextChannel = guildChannels.find(c => c && c.name.toLowerCase().includes(voiceChannel.name.toLowerCase()) && c.type === ChannelType.GuildText);
                    }

                    if (!targetTextChannel) {
                        targetTextChannel = interaction.channel;
                    }

                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });

                    const player = createAudioPlayer();
                    connection.subscribe(player);

                    const controlEmbed = new EmbedBuilder()
                        .setColor('#2b2d31')
                        .setDescription('تحكم ببوت الاغاني من هنا');

                    const row1 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_search').setLabel('تشغيل اغنية').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_stop').setLabel('ايقاف الاغنية').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_vol').setLabel('رفع الصوت').setStyle(ButtonStyle.Secondary)
                    );

                    const row2 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_perm').setLabel('صلاحية').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_remove_perm').setLabel('ازالة صلاحية').setStyle(ButtonStyle.Secondary)
                    );

                    const controlMsg = await targetTextChannel.send({
                        content: `مرحباً بك <@${member.id}>`,
                        embeds: [controlEmbed],
                        components: [row1, row2]
                    });

                    activeSessions.set(voiceChannel.id, {
                        connection,
                        player,
                        ownerId: member.id,
                        allowedUsers: [member.id],
                        volume: 100,
                        currentSong: null,
                        controlMsgId: controlMsg.id,
                        channelId: targetTextChannel.id
                    });

                    await sendOrUpdatePanel();
                } catch (err) {
                    console.error(err);
                    await sendOrUpdatePanel();
                }
            }
        }
    }

    if (interaction.isButton()) {
        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;
        const session = voiceChannel ? activeSessions.get(voiceChannel.id) : null;

        if (!session) {
            return interaction.reply({ content: 'البوت ليس موجوداً في رومك الصوتي!', ephemeral: true });
        }

        if (session.ownerId !== member.id && !session.allowedUsers.includes(member.id)) {
            return interaction.reply({ content: 'ليس لديك صلاحية', ephemeral: true });
        }

        const customId = interaction.customId;

        if (customId === 'btn_search') {
            const modal = new ModalBuilder()
                .setCustomId('search_song_modal')
                .setTitle('البحث عن الاغاني');

            const songInput = new TextInputBuilder()
                .setCustomId('song_query')
                .setLabel('اكتب اسم الاغنية أو الرابط')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('مثال: شوفك شفايا')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(songInput));
            return await interaction.showModal(modal);
        }

        if (customId === 'btn_stop') {
            if (session.player) {
                session.player.stop();
                session.currentSong = null;
            }
            return interaction.reply({ content: 'تم إيقاف الأغنية بنجاح', ephemeral: true });
        }

        if (customId === 'btn_vol') {
            const modal = new ModalBuilder()
                .setCustomId('volume_modal')
                .setTitle('صوت الاغنية');

            const volInput = new TextInputBuilder()
                .setCustomId('volume_value')
                .setLabel('اكتب عدد الصوت (من 50 إلى 1000)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('مثال: 150')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(volInput));
            return await interaction.showModal(modal);
        }

        if (customId === 'btn_perm') {
            const modal = new ModalBuilder()
                .setCustomId('perm_modal')
                .setTitle('اعطاء صلاحية');

            const userInput = new TextInputBuilder()
                .setCustomId('target_user')
                .setLabel('منشن الشخص أو آيدي المستخدم')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('اكتب آيدي الشخص هنا')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(userInput));
            return await interaction.showModal(modal);
        }

        if (customId === 'btn_remove_perm') {
            const modal = new ModalBuilder()
                .setCustomId('remove_perm_modal')
                .setTitle('ازالة صلاحية');

            const userInput = new TextInputBuilder()
                .setCustomId('target_user')
                .setLabel('منشن الشخص أو آيدي المستخدم')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('اكتب آيدي الشخص هنا')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(userInput));
            return await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;
        const session = voiceChannel ? activeSessions.get(voiceChannel.id) : null;

        if (!session) {
            return interaction.reply({ content: 'البوت ليس موجوداً في رومك الصوتي!', ephemeral: true });
        }

        if (session.ownerId !== member.id && !session.allowedUsers.includes(member.id)) {
            return interaction.reply({ content: 'ليس لديك صلاحية', ephemeral: true });
        }

        if (interaction.customId === 'search_song_modal') {
            const query = interaction.fields.getTextInputValue('song_query');
            await interaction.deferReply({ ephemeral: true });

            try {
                let streamData;
                if (play.yt_validate(query) === 'video') {
                    streamData = await play.stream(query);
                } else {
                    const searchResult = await play.search(query, { limit: 1 });
                    if (!searchResult || searchResult.length === 0) {
                        return interaction.editReply({ content: 'لم يتم العثور على نتائج لهذه الأغنية.' });
                    }
                    streamData = await play.stream(searchResult[0].url);
                    session.currentSong = searchResult[0].title;
                }

                const resource = createAudioResource(streamData.stream, {
                    inputType: streamData.type,
                    inlineVolume: true
                });

                const volMultiplier = session.volume / 100;
                resource.volume.setVolume(volMultiplier);

                session.player.play(resource);

                await interaction.editReply({ content: 'تم تشغيل الأغنية بنجاح!' });
            } catch (err) {
                console.error(err);
                await interaction.editReply({ content: 'حدث خطأ أثناء تشغيل الأغنية، تأكد من الرابط أو اسم الأغنية.' });
            }
        }

        if (interaction.customId === 'volume_modal') {
            const rawVal = interaction.fields.getTextInputValue('volume_value');
            const vol = parseInt(rawVal);

            if (isNaN(vol) || vol < 50 || vol > 1000) {
                return interaction.reply({ content: 'يجب أن يكون قيمة الصوت بين 50 و 1000', ephemeral: true });
            }

            session.volume = vol;
            if (session.player && session.player.state.resource && session.player.state.resource.volume) {
                session.player.state.resource.volume.setVolume(vol / 100);
            }

            return interaction.reply({ content: `تم ضبط الصوت على ${vol}`, ephemeral: true });
        }

        if (interaction.customId === 'perm_modal') {
            const targetId = interaction.fields.getTextInputValue('target_user').replace(/<@!?(\d+)>/, '$1');
            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

            if (!targetMember) {
                return interaction.reply({ content: 'لم يتم العثور على هذا الشخص!', ephemeral: true });
            }

            if (!session.allowedUsers.includes(targetId)) {
                session.allowedUsers.push(targetId);
            }

            return interaction.reply({ content: `تم إعطاء صلاحية التحكم لـ <@${targetId}>`, ephemeral: true });
        }

        if (interaction.customId === 'remove_perm_modal') {
            const targetId = interaction.fields.getTextInputValue('target_user').replace(/<@!?(\d+)>/, '$1');
            
            if (targetId === session.ownerId) {
                return interaction.reply({ content: 'لا يمكنك إزالة الصلاحية من صاحب الروم الأساسي!', ephemeral: true });
            }

            const index = session.allowedUsers.indexOf(targetId);
            if (index > -1) {
                session.allowedUsers.splice(index, 1);
            }

            return interaction.reply({ content: `تم إزالة الصلاحية من <@${targetId}>`, ephemeral: true });
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    for (const [channelId, session] of activeSessions.entries()) {
        if (oldState.member && oldState.member.id === session.ownerId && oldState.channelId === channelId && newState.channelId !== channelId) {
            try {
                if (session.connection) {
                    session.connection.destroy();
                }
                if (session.controlMsgId) {
                    const channel = await client.channels.fetch(session.channelId).catch(() => null);
                    if (channel) {
                        const msg = await channel.messages.fetch(session.controlMsgId).catch(() => null);
                        if (msg) await msg.delete().catch(() => {});
                    }
                }
            } catch (e) {
                console.error('Error removing bot on owner leave:', e);
            }
            activeSessions.delete(channelId);
        }
    }

    if (oldState.member && oldState.member.id === client.user.id && oldState.channelId && !newState.channelId) {
        for (const [channelId, session] of activeSessions.entries()) {
            if (session.connection === oldState.connection || channelId === oldState.channelId) {
                if (session.controlMsgId) {
                    try {
                        const channel = await client.channels.fetch(session.channelId);
                        if (channel) {
                            const msg = await channel.messages.fetch(session.controlMsgId);
                            if (msg) await msg.delete().catch(() => {});
                        }
                    } catch (e) {}
                }
                activeSessions.delete(channelId);
            }
        }
    }
});

client.login(process.env.TOKEN);

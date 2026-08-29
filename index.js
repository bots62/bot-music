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

async function setupControlRefresh(voiceChannelId) {
    const interval = setInterval(async () => {
        const session = activeSessions.get(voiceChannelId);
        if (!session) {
            return clearInterval(interval);
        }

        try {
            const channel = await client.channels.fetch(session.channelId).catch(() => null);
            if (!channel) return;

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
                embeds: [controlEmbed],
                components: [row1, row2]
            });

            session.controlMsgId = newMsg.id;
        } catch (e) {
            console.error('Error refreshing control message:', e);
        }
    }, 5 * 60 * 1000);

    return interval;
}

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'music_panel_menu') {
            const choice = interaction.values[0];
            const member = interaction.member;
            const voiceChannel = member?.voice?.channel;

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

                if (activeSessions.has(voiceChannel.id)) {
                    return interaction.followUp({ content: 'هذا الروم يحتوي على بوت مضاف مسبقاً!', ephemeral: true });
                }

                if (activeSessions.size >= availableBots.length) {
                    return interaction.followUp({ content: 'لا توجد بوتات كافية حالياً!', ephemeral: true });
                }

                try {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });

                    const player = createAudioPlayer();
                    connection.subscribe(player);

                    let targetTextChannel = voiceChannel;
                    
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
                        embeds: [controlEmbed],
                        components: [row1, row2]
                    }).catch(async () => {
                        return await interaction.channel.send({
                            embeds: [controlEmbed],
                            components: [row1, row2]
                        });
                    });

                    const refreshInterval = await setupControlRefresh(voiceChannel.id);

                    activeSessions.set(voiceChannel.id, {
                        connection,
                        player,
                        ownerId: member.id,
                        allowedUsers: [member.id],
                        volume: 100,
                        currentSong: null,
                        controlMsgId: controlMsg.id,
                        channelId: targetTextChannel.id,
                        refreshInterval
                    });

                    await interaction.followUp({ content: 'تم إدخال البوت لرومك الصوتي بنجاح!', ephemeral: true });
                } catch (err) {
                    console.error(err);
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
                .setPlaceholder('اكتب اسم اغنيه مثال شوفك شفا')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(songInput));
            return await interaction.showModal(modal);
        }

        if (customId === 'btn_stop') {
            if (session.player) {
                session.player.stop();
                session.currentSong = null;
            }
            return interaction.reply({ content: 'تم ايقاف الاغنية', ephemeral: true });
        }

        if (customId === 'btn_vol') {
            const modal = new ModalBuilder()
                .setCustomId('volume_modal')
                .setTitle('رفع الصوت');

            const volInput = new TextInputBuilder()
                .setCustomId('volume_value')
                .setLabel('اكتب صوت الاغنية مثال v50 v1000')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('مثال: v400')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(volInput));
            return await interaction.showModal(modal);
        }

        if (customId === 'btn_perm') {
            const modal = new ModalBuilder()
                .setCustomId('perm_modal')
                .setTitle('صلاحية');

            const userInput = new TextInputBuilder()
                .setCustomId('target_user')
                .setLabel('اختار لمن تعطيه صلاحية')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('اكتب يوزر الذي تريد اعطائه صلاحية مثال softrayn')
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
                .setLabel('اختار شخص لازالة صلاحيتة')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('زيل صلاحية شخص مثال softrayn')
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
            return interaction.reply({ content: 'ما معك صلاحية', ephemeral: true });
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
            const rawVal = interaction.fields.getTextInputValue('volume_value').toLowerCase().replace('v', '');
            const vol = parseInt(rawVal);

            if (isNaN(vol) || vol < 50 || vol > 1000) {
                return interaction.reply({ content: 'أعلى حد v1000 اقل حد v50', ephemeral: true });
            }

            session.volume = vol;
            if (session.player && session.player.state.resource && session.player.state.resource.volume) {
                session.player.state.resource.volume.setVolume(vol / 100);
            }

            const multiplierText = (vol / 100).toFixed(2).replace('.', ',');
            return interaction.reply({ content: `تم اختيار الصوت v${vol} (ضعف الصوت الطبيعي ${multiplierText} مرة)`, ephemeral: true });
        }

        if (interaction.customId === 'perm_modal') {
            const inputVal = interaction.fields.getTextInputValue('target_user').trim();
            let targetMember = null;

            if (inputVal.startsWith('<@') && inputVal.endsWith('>')) {
                const targetId = inputVal.replace(/<@!?(\d+)>/, '$1');
                targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
            } else {
                const fetchedMembers = await interaction.guild.members.fetch({ query: inputVal, limit: 1 }).catch(() => null);
                targetMember = fetchedMembers?.first() || null;
            }

            if (!targetMember) {
                return interaction.reply({ content: 'لم يتم العثور على هذا الشخص!', ephemeral: true });
            }

            if (!session.allowedUsers.includes(targetMember.id)) {
                session.allowedUsers.push(targetMember.id);
            }

            return interaction.reply({ content: `تم إعطاء صلاحية التحكم لـ <@${targetMember.id}>`, ephemeral: true });
        }

        if (interaction.customId === 'remove_perm_modal') {
            const inputVal = interaction.fields.getTextInputValue('target_user').trim();
            let targetMember = null;

            if (inputVal.startsWith('<@') && inputVal.endsWith('>')) {
                const targetId = inputVal.replace(/<@!?(\d+)>/, '$1');
                targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
            } else {
                const fetchedMembers = await interaction.guild.members.fetch({ query: inputVal, limit: 1 }).catch(() => null);
                targetMember = fetchedMembers?.first() || null;
            }

            if (!targetMember) {
                return interaction.reply({ content: 'لم يتم العثور على هذا الشخص!', ephemeral: true });
            }

            if (targetMember.id === session.ownerId) {
                return interaction.reply({ content: 'لا يمكنك إزالة الصلاحية من صاحب الروم الأساسي!', ephemeral: true });
            }

            const index = session.allowedUsers.indexOf(targetMember.id);
            if (index > -1) {
                session.allowedUsers.splice(index, 1);
                return interaction.reply({ content: `تم ازالة الصلاحية`, ephemeral: true });
            } else {
                return interaction.reply({ content: `هذا الشخص لايملك صلاحية`, ephemeral: true });
            }
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    for (const [channelId, session] of activeSessions.entries()) {
        if (oldState.member && oldState.member.id === session.ownerId && oldState.channelId === channelId && newState.channelId !== channelId) {
            try {
                if (session.refreshInterval) clearInterval(session.refreshInterval);
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
            } catch (e) {}
            activeSessions.delete(channelId);
        }
    }

    if (oldState.member && oldState.member.id === client.user.id && oldState.channelId && !newState.channelId) {
        for (const [channelId, session] of activeSessions.entries()) {
            if (session.connection === oldState.connection || channelId === oldState.channelId) {
                if (session.refreshInterval) clearInterval(session.refreshInterval);
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

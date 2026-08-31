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
                        .setColor('#18191c')
                        .setDescription('**Now Playing**\n\nابحث عن أغنية للبدء...');

                    // الأزرار الأولية للتحكم الشامل
                    const row1 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_search').setLabel('تشغيل أغنية').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('btn_pause_resume').setLabel('إيقاف/استئناف').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_stop').setLabel('إيقاف نهائي').setStyle(ButtonStyle.Danger)
                    );

                    const row2 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_vol_down').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_vol_up').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_next').setEmoji('⏭️').setStyle(ButtonStyle.Secondary)
                    );

                    const controlMsg = await targetTextChannel.send({
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
                        currentSongData: null,
                        savedSongs: [],
                        savedIndex: 0,
                        isPaused: false,
                        loop: false,
                        shuffle: false,
                        controlMsgId: controlMsg.id,
                        channelId: targetTextChannel.id
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
            if (session.player) {
                session.player.stop();
                session.currentSong = null;
                session.currentSongData = null;
            }
            return interaction.reply({ content: `Playback stopped by <@${member.id}>`, ephemeral: true });
        }

        if (customId === 'btn_pause_resume') {
            if (!session.player) return interaction.reply({ content: 'لا توجد أغنية مشغلة حالياً', ephemeral: true });
            if (session.isPaused) {
                session.player.unpause();
                session.isPaused = false;
                return interaction.reply({ content: 'تم استئناف الأغنية', ephemeral: true });
            } else {
                session.player.pause();
                session.isPaused = true;
                return interaction.reply({ content: 'تم إيقاف الأغنية مؤقتاً', ephemeral: true });
            }
        }

        if (customId === 'btn_vol_down') {
            let newVol = session.volume - 25;
            if (newVol < 50) newVol = 50;
            session.volume = newVol;
            if (session.player && session.player.state.resource && session.player.state.resource.volume) {
                session.player.state.resource.volume.setVolume(newVol / 100);
            }
            return interaction.reply({ content: `تم خفض الصوت إلى V${newVol}`, ephemeral: true });
        }

        if (customId === 'btn_vol_up') {
            let newVol = session.volume + 25;
            if (newVol > 1000) newVol = 1000;
            session.volume = newVol;
            if (session.player && session.player.state.resource && session.player.state.resource.volume) {
                session.player.state.resource.volume.setVolume(newVol / 100);
            }
            return interaction.reply({ content: `تم رفع الصوت إلى V${newVol}`, ephemeral: true });
        }

        if (customId === 'btn_loop') {
            session.loop = !session.loop;
            return interaction.reply({ content: `حالة التكرار (Loop): ${session.loop ? 'ON' : 'OFF'}`, ephemeral: true });
        }

        if (session.savedSongs.length === 0) {
            return interaction.reply({ content: 'أنت مو حافظ أغاني. اكتب اسم الأغنية أو احفظها أولاً.', ephemeral: true });
        }

        if (customId === 'btn_next' || customId === 'btn_shuffle') {
            session.savedIndex = (session.savedIndex + 1) % session.savedSongs.length;
            const songToPlay = session.savedSongs[session.savedIndex];
            
            try {
                await interaction.deferReply({ ephemeral: true });
                const searchResults = await play.search(songToPlay, { limit: 1 });
                if (!searchResults || searchResults.length === 0) {
                    return interaction.editReply({ content: 'لم يتم العثور على الأغنية المحفوظة.' });
                }
                const track = searchResults[0];
                session.currentSongData = track;

                const streamData = await play.stream(track.url);
                const resource = createAudioResource(streamData.stream, {
                    inputType: streamData.type,
                    inlineVolume: true
                });
                resource.volume.setVolume(session.volume / 100);
                session.player.play(resource);

                await interaction.editReply({ content: `تم التبديل إلى: ${track.title}` });
            } catch (e) {
                console.error(e);
            }
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
                    break;
                }
            }
        }

        if (!session) return;

        if (interaction.customId === 'search_song_modal') {
            const query = interaction.fields.getTextInputValue('song_query');

            await interaction.deferReply({ ephemeral: true });

            try {
                const searchResults = await play.search(query, { limit: 1 });
                if (!searchResults || searchResults.length === 0) {
                    return interaction.editReply({ content: 'لم يتم العثور على نتائج لهذه الأغنية.' });
                }
                const track = searchResults[0];
                session.currentSongData = track;

                const streamData = await play.stream(track.url);
                const resource = createAudioResource(streamData.stream, {
                    inputType: streamData.type,
                    inlineVolume: true
                });

                resource.volume.setVolume(session.volume / 100);
                session.player.play(resource);

                const embed = new EmbedBuilder()
                    .setColor('#18191c')
                    .setTitle('Now Playing')
                    .setDescription(`**${track.title}**\nby <@${member.id}>\n\nDuration: ${track.duration}\nPlatform: YouTube`)
                    .setThumbnail(track.thumbnail);

                const channel = await client.channels.fetch(session.channelId).catch(() => null);
                if (channel) {
                    // رسالة تفاصيل الأغنية وقائمتها المخفية/الخاصة تظهر عند تشغيلها
                    const songButtons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_pause_resume').setEmoji('⏯️').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_next').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Secondary)
                    );
                    await channel.send({ embeds: [embed], components: [songButtons] }).catch(() => {});
                }

                await interaction.editReply({ content: 'تم تشغيل الأغنية بنجاح!' });
            } catch (err) {
                console.error(err);
                await interaction.editReply({ content: 'حدث خطأ أثناء تشغيل الأغنية.' });
            }
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.startsWith('حفظ ')) {
        const songName = message.content.slice(4).trim();
        if (!songName) return;

        let voiceChannel = message.member?.voice?.channel;
        let session = voiceChannel ? activeSessions.get(voiceChannel.id) : null;
        
        if (!session) {
            for (const [chId, sess] of activeSessions.entries()) {
                const ch = message.guild.channels.cache.get(chId);
                if (ch && ch.members.has(message.author.id)) {
                    session = sess;
                    break;
                }
            }
        }

        if (!session) {
            return message.reply({ content: 'يجب أن يكون البوت مضافاً في رومك الصوتي لتتمكن من حفظ الأغاني.', ephemeral: true }).catch(() => {});
        }

        if (!session.savedSongs.includes(songName)) {
            session.savedSongs.push(songName);
        }

        await message.react('✅').catch(() => {});
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    for (const [channelId, session] of activeSessions.entries()) {
        if (oldState.member && oldState.member.id === session.ownerId && oldState.channelId === channelId && newState.channelId !== channelId) {
            try {
                if (session.connection) session.connection.destroy();
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
});

client.login(process.env.TOKEN);

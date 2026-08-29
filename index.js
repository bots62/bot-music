const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
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
            .setPlaceholder('اختر امرا من القائمة')
            .addOptions([
                {
                    label: 'اضافة البوت',
                    value: 'add_bot'
                },
                {
                    label: 'البحث عن الاغاني',
                    value: 'search_song'
                },
                {
                    label: 'ايقاف الاغنية',
                    value: 'stop_song'
                },
                {
                    label: 'صوت الاغنية',
                    value: 'volume_control'
                },
                {
                    label: 'صلاحية',
                    value: 'permissions'
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
    if (!interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    if (interaction.customId === 'music_panel_menu') {
        const choice = interaction.values[0];
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel && choice !== 'add_bot') {
            return interaction.reply({ content: 'البوت مو برومك', ephemeral: true });
        }

        const session = voiceChannel ? activeSessions.get(voiceChannel.id) : null;

        if (choice === 'add_bot') {
            if (!voiceChannel) {
                await interaction.reply({ content: 'منشن رومك أو ادخل روم صوتية أولاً!', ephemeral: true });
                return;
            }

            if (activeSessions.has(voiceChannel.id)) {
                await interaction.reply({ content: 'هذا الروم فيه بوت من قبل!', ephemeral: true });
                return;
            }

            if (activeSessions.size >= 10) {
                await interaction.reply({ content: 'لا يوجد عدد بوتات متوفر، انتظر شوي.', ephemeral: true });
                return;
            }

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });

                const player = createAudioPlayer();
                connection.subscribe(player);

                activeSessions.set(voiceChannel.id, {
                    connection,
                    player,
                    ownerId: member.id,
                    allowedUsers: [member.id],
                    volume: 100,
                    currentSong: null
                });

                // تحديث التفاعل بدون رسائل ظاهرة وبدون علامة صح مزعجة لتكرار الضغط
                await interaction.deferUpdate();
                return;
            } catch (err) {
                console.error(err);
                await interaction.reply({ content: 'حدث خطأ أثناء محاولة دخول الروم.', ephemeral: true });
                return;
            }
        }

        if (!session) {
            return interaction.reply({ content: 'البوت مو برومك', ephemeral: true });
        }

        if (session.ownerId !== member.id && !session.allowedUsers.includes(member.id)) {
            return interaction.reply({ content: 'لست صاحب الروم أو ليس لديك صلاحية التحكم!', ephemeral: true });
        }

        // استخدام deferUpdate لكل الخيارات لكي لا يظهر خطأ ولا علامة صح تمنع إعادة الضغط
        await interaction.deferUpdate();

        if (choice === 'search_song') {
            const modal = new ModalBuilder()
                .setCustomId('search_song_modal')
                .setTitle('البحث عن الاغاني');

            const songInput = new TextInputBuilder()
                .setCustomId('song_query')
                .setLabel('اكتب اسم الاغنية أو الرابط')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('مثال: شوفك شفاي')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(songInput));
            return await interaction.showModal(modal);
        }

        if (choice === 'stop_song') {
            if (session.player) {
                session.player.stop();
                session.currentSong = null;
            }
            return;
        }

        if (choice === 'volume_control') {
            const modal = new ModalBuilder()
                .setCustomId('volume_modal')
                .setTitle('صوت الاغنية');

            const volInput = new TextInputBuilder()
                .setCustomId('volume_value')
                .setLabel('اكتب عدد الصوت (من V50 إلى V1000)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('مثال: v50 أو v1000')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(volInput));
            return await interaction.showModal(modal);
        }

        if (choice === 'permissions') {
            const modal = new ModalBuilder()
                .setCustomId('perm_modal')
                .setTitle('صلاحية التحكم');

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
            return interaction.reply({ content: 'البوت مو برومك', ephemeral: true });
        }

        if (interaction.customId === 'search_song_modal') {
            const query = interaction.fields.getTextInputValue('song_query');
            await interaction.deferReply({ ephemeral: true });

            try {
                const searchResult = await play.search(query, { limit: 1 });
                if (!searchResult || searchResult.length === 0) {
                    return interaction.editReply({ content: 'لم يتم العثور على نتائج لهذه الاغنية.' });
                }

                const song = searchResult[0];
                const stream = await play.stream(song.url);
                const resource = createAudioResource(stream.stream, {
                    inputType: stream.type,
                    inlineVolume: true
                });

                const volMultiplier = session.volume / 100;
                resource.volume.setVolume(volMultiplier);

                session.player.play(resource);
                session.currentSong = song.title;

                await interaction.editReply({ content: `ابحث عن اغاني: ${query}\nتم بدء تشغيل: **${song.title}**` });
            } catch (err) {
                console.error(err);
                await interaction.editReply({ content: 'حدث خطأ أثناء تشغيل الاغنية.' });
            }
        }

        if (interaction.customId === 'volume_modal') {
            const rawVal = interaction.fields.getTextInputValue('volume_value').toLowerCase().replace('v', '');
            const vol = parseInt(rawVal);

            if (isNaN(vol) || vol < 50) {
                return interaction.reply({ content: 'اقل حد للصوت V50', ephemeral: true });
            }
            if (vol > 1000) {
                return interaction.reply({ content: 'اعلى حد للصوت V1000', ephemeral: true });
            }

            session.volume = vol;
            if (session.player && session.player.state.resource && session.player.state.resource.volume) {
                session.player.state.resource.volume.setVolume(vol / 100);
            }

            return interaction.reply({ content: `تم رفع صوت الاغنية إلى V${vol}`, ephemeral: true });
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

            return interaction.reply({ content: `تم منح صلاحية التحكم للمستخدم <@${targetId}>`, ephemeral: true });
        }
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.member && oldState.member.id === client.user.id && oldState.channelId && !newState.channelId) {
        activeSessions.delete(oldState.channelId);
    }
});

client.login(process.env.TOKEN);

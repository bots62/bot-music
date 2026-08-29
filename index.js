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
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
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
    if (!interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    if (interaction.customId === 'music_panel_menu') {
        const choice = interaction.values[0];
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (choice === 'add_bot') {
            if (!voiceChannel) {
                return interaction.reply({ content: 'ادخل روم صوتية أولا!', ephemeral: true });
            }

            if (activeSessions.has(voiceChannel.id)) {
                return interaction.reply({ content: 'هذا الروم فيه بوت من قبل!', ephemeral: true });
            }

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });

                const player = createAudioPlayer();
                connection.subscribe(player);

                await interaction.deferUpdate();

                const controlEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setDescription('تحكم ببوت الاغاني من هنا');

                const controlMenu = new StringSelectMenuBuilder()
                    .setCustomId('bot_control_menu')
                    .setPlaceholder('اختر امرا من القائمة')
                    .addOptions([
                        { label: 'رفع الصوت', value: 'volume_control' },
                        { label: 'تشغيل اغنية', value: 'search_song' },
                        { label: 'ايقاف الاغنية', value: 'stop_song' },
                        { label: 'صلاحية', value: 'give_perm' },
                        { label: 'ازالة صلاحية', value: 'remove_perm' }
                    ]);

                const row = new ActionRowBuilder().addComponents(controlMenu);
                const controlMsg = await interaction.channel.send({
                    content: `مرحباً بك <@${member.id}>`,
                    embeds: [controlEmbed],
                    components: [row]
                });

                activeSessions.set(voiceChannel.id, {
                    connection,
                    player,
                    ownerId: member.id,
                    allowedUsers: [member.id],
                    volume: 100,
                    currentSong: null,
                    controlMsgId: controlMsg.id,
                    channelId: interaction.channel.id
                });

                return;
            } catch (err) {
                console.error(err);
                return interaction.reply({ content: 'حدث خطأ أثناء محاولة دخول الروم.', ephemeral: true });
            }
        }

        const session = voiceChannel ? activeSessions.get(voiceChannel.id) : null;
        if (!session) {
            return interaction.reply({ content: 'البوت مو برومك', ephemeral: true });
        }

        if (session.ownerId !== member.id && !session.allowedUsers.includes(member.id)) {
            return interaction.reply({ content: 'لست صاحب الروم أو ليس لديك صلاحية التحكم!', ephemeral: true });
        }

        await interaction.deferUpdate();

        if (choice === 'search_song') {
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

        if (choice === 'stop_song') {
            if (session.player) {
                session.player.stop();
                const songName = session.currentSong || 'الاغنية';
                session.currentSong = null;
                const tempMsg = await interaction.channel.send({ content: `تم ايقاف الاغنية ${songName}` });
                setTimeout(() => tempMsg.delete().catch(() => {}), 4000);
            }
            return;
        }

        if (choice === 'volume_control') {
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

        if (choice === 'give_perm') {
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

        if (choice === 'remove_perm') {
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
            return interaction.reply({ content: 'البوت مو برومك', ephemeral: true });
        }

        if (interaction.customId === 'search_song_modal') {
            const query = interaction.fields.getTextInputValue('song_query');
            await interaction.deferReply({ ephemeral: true });

            try {
                const searchResult = await play.search(query, { limit: 1 });
                if (!searchResult || searchResult.length === 0) {
                    await interaction.editReply({ content: 'لم يتم العثور على نتائج.' });
                    const msg = await interaction.fetchReply();
                    setTimeout(() => msg.delete().catch(() => {}), 4000);
                    return;
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

                await interaction.editReply({ content: `تم تشغيل: **${song.title}**` });
                const msg = await interaction.fetchReply();
                setTimeout(() => msg.delete().catch(() => {}), 4000);
            } catch (err) {
                console.error(err);
                await interaction.editReply({ content: 'حدث خطأ أثناء تشغيل الاغنية.' });
            }
        }

        if (interaction.customId === 'volume_modal') {
            const rawVal = interaction.fields.getTextInputValue('volume_value');
            const vol = parseInt(rawVal);

            if (isNaN(vol) || vol < 50) {
                await interaction.reply({ content: 'أقل حد للصوت هو 50', ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
                return;
            }
            if (vol > 1000) {
                await interaction.reply({ content: 'أعلى حد للصوت هو 1000', ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
                return;
            }

            session.volume = vol;
            if (session.player && session.player.state.resource && session.player.state.resource.volume) {
                session.player.state.resource.volume.setVolume(vol / 100);
            }

            await interaction.reply({ content: `تم رفع صوت الاغنية إلى ${vol}`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
            return;
        }

        if (interaction.customId === 'perm_modal') {
            const targetId = interaction.fields.getTextInputValue('target_user').replace(/<@!?(\d+)>/, '$1');
            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

            if (!targetMember) {
                await interaction.reply({ content: 'لم يتم العثور على هذا الشخص!', ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
                return;
            }

            if (!session.allowedUsers.includes(targetId)) {
                session.allowedUsers.push(targetId);
            }

            await interaction.reply({ content: `تم إعطاء صلاحية لهذا الشخص <@${targetId}>`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
            return;
        }

        if (interaction.customId === 'remove_perm_modal') {
            const targetId = interaction.fields.getTextInputValue('target_user').replace(/<@!?(\d+)>/, '$1');
            
            if (targetId === session.ownerId) {
                await interaction.reply({ content: 'لا يمكنك إزالة الصلاحية من صاحب الروم الأساسي!', ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
                return;
            }

            const index = session.allowedUsers.indexOf(targetId);
            if (index > -1) {
                session.allowedUsers.splice(index, 1);
            }

            await interaction.reply({ content: `تم إزالة الصلاحية من هذا الشخص <@${targetId}>`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
            return;
        }
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    // إذا الشخص المستدعي للبوت طلع من الروم، البوت يخرج وراه مباشرة
    if (oldState.channelId && activeSessions.has(oldState.channelId)) {
        const session = activeSessions.get(oldState.channelId);
        if (oldState.member.id === session.ownerId && !newState.channelId) {
            if (session.connection) {
                session.connection.destroy();
            }
            activeSessions.delete(oldState.channelId);
            return;
        }
    }

    // إذا البوت نفسه طلع أو انطرد من الروم
    if (oldState.member && oldState.member.id === client.user.id && oldState.channelId && !newState.channelId) {
        activeSessions.delete(oldState.channelId);
    }
});

client.login(process.env.TOKEN);

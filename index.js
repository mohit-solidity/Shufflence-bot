require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TEAM_ROLE_NAME = process.env.TEAM_ROLE_NAME || "Shufflence_Bot";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error("[ERROR] Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in your environment configuration (.env).");
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const commands = [
    new SlashCommandBuilder()
        .setName("setup-help-panel")
        .setDescription("Deploy the Community Help panel.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName("close-ticket")
        .setDescription("Close the active help request ticket.")
].map(command => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );
    console.log("[INFO] Slash commands successfully registered.");
}

function isTeamMember(interaction) {
    if (interaction.guild.ownerId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    const role = interaction.guild.roles.cache.find(
        r => r.name === TEAM_ROLE_NAME
    );

    return Boolean(role && interaction.member.roles.cache.has(role.id));
}

function getTeamRole(guild) {
    return guild.roles.cache.find(r => r.name === TEAM_ROLE_NAME);
}

function buildHelpPanel() {
    const embed = new EmbedBuilder()
        .setTitle("❤️ Community Help Panel")
        .setDescription(
            "Need assistance with an essential expense?\n\n" +
            "You may submit a confidential request for items such as:\n\n" +
            "🍔 Food & Groceries\n" +
            "💡 Utility Bills\n" +
            "🚗 Transportation\n" +
            "🏠 Housing & Essential Expenses\n" +
            "📦 Other Critical Needs\n\n" +
            "Your ticket will remain strictly private between you and our support team."
        )
        .setColor(0x5865F2)
        .setFooter({ text: "Please ensure all provided details are accurate." });

    const button = new ButtonBuilder()
        .setCustomId("help:open")
        .setLabel("Send Help Request")
        .setEmoji("📝")
        .setStyle(ButtonStyle.Primary);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(button)]
    };
}

function buildButtonsForStatus(status) {
    const row = new ActionRowBuilder();

    if (status === "APPROVED" || status === "REJECTED") {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId("help:unapproved")
                .setLabel("Make Pending")
                .setEmoji("↩️")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("help:close")
                .setLabel("Close Ticket")
                .setEmoji("🔒")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("help:delete")
                .setLabel("Delete Ticket")
                .setEmoji("🗑️")
                .setStyle(ButtonStyle.Danger)
        );
    } else if (status === "CLOSED") {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId("help:reopen")
                .setLabel("Reopen Ticket")
                .setEmoji("🔓")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("help:delete")
                .setLabel("Delete Ticket")
                .setEmoji("🗑️")
                .setStyle(ButtonStyle.Danger)
        );
    } else {
        // PENDING REVIEW
        row.addComponents(
            new ButtonBuilder()
                .setCustomId("help:approve")
                .setLabel("Approve")
                .setEmoji("✅")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("help:reject")
                .setLabel("Reject")
                .setEmoji("❌")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("help:info")
                .setLabel("Need More Info")
                .setEmoji("💬")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("help:close")
                .setLabel("Close Ticket")
                .setEmoji("🔒")
                .setStyle(ButtonStyle.Secondary)
        );
    }

    return row;
}

function buildConfirmButtons(actionType) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`help:${actionType}_confirm`)
            .setLabel("Confirm Action")
            .setEmoji("✔️")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("help:cancel")
            .setLabel("Cancel")
            .setEmoji("✖️")
            .setStyle(ButtonStyle.Secondary)
    );
}

async function findOrCreateCategory(guild, categoryName) {
    let category = guild.channels.cache.find(
        c =>
            c.type === ChannelType.GuildCategory &&
            c.name.toLowerCase() === categoryName.toLowerCase()
    );

    if (!category) {
        category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory
        });
    }

    return category;
}

async function createHelpTicket(interaction, data) {
    const guild = interaction.guild;
    const teamRole = getTeamRole(guild);

    if (!teamRole) {
        await interaction.reply({
            content: `❌ Configuration Error: Unable to locate the team role **${TEAM_ROLE_NAME}**. Please ensure it exists on this server.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const existing = guild.channels.cache.find(
        channel =>
            channel.type === ChannelType.GuildText &&
            channel.topic === `help-requester:${interaction.user.id}`
    );

    if (existing) {
        await interaction.reply({
            content: `❌ You already possess an active support ticket: ${existing}`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const category = await findOrCreateCategory(guild, "HELP REQUESTS");

    const safeName = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 40) || "user";

    const channel = await guild.channels.create({
        name: `help-${safeName}-${interaction.user.id.slice(-4)}`,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `help-requester:${interaction.user.id}`,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            },
            {
                id: teamRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            },
            {
                id: client.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            }
        ]
    });

    const proofText = data.proof?.trim() ? data.proof.trim() : "No evidence/links supplied.";

    const embed = new EmbedBuilder()
        .setTitle("❤️ New Community Help Request")
        .setDescription("A confidential support ticket has been opened.\nAccess is restricted exclusively to the requester and authorized team members.")
        .setColor(0x5865F2)
        .addFields(
            { name: "👤 Requester", value: `${interaction.user} (\`${interaction.user.tag}\`)` },
            { name: "🆔 User ID", value: `\`${interaction.user.id}\`` },
            { name: "🆘 Nature of Assistance", value: data.need },
            { name: "💰 Requested Amount", value: data.amount },
            { name: "📝 Detailed Explanation", value: data.explanation },
            { name: "🔗 Proof / Evidence", value: proofText },
            { name: "💳 Preferred Payout", value: data.payment }
        )
        .setTimestamp()
        .setFooter({ text: "Status: PENDING REVIEW" });

    await channel.send({
        content: `${interaction.user} <@&${teamRole.id}>`,
        embeds: [embed],
        components: [buildButtonsForStatus("PENDING")]
    });

    await interaction.reply({
        content: `✅ Your support request has been created securely: ${channel}`,
        flags: MessageFlags.Ephemeral
    });
}

client.once("ready", async () => {
    console.log(`[INFO] Authenticated successfully as ${client.user.tag}`);
    try {
        await registerCommands();
    } catch (error) {
        console.error("[ERROR] Failed to register slash commands:", error);
    }
});

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === "setup-help-panel") {
                await interaction.reply(buildHelpPanel());
                return;
            }

            if (interaction.commandName === "close-ticket") {
                if (!interaction.channel || !interaction.channel.topic?.startsWith("help-requester:")) {
                    await interaction.reply({
                        content: "❌ This command is restricted for use inside verified help tickets.",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (!isTeamMember(interaction)) {
                    await interaction.reply({
                        content: "❌ Unauthorized: Only team personnel can execute close procedures.",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                await closeTicket(interaction);
                return;
            }
        }

        if (interaction.isButton() && interaction.customId === "help:open") {
            const modal = new ModalBuilder()
                .setCustomId("help:form")
                .setTitle("Community Help Request Form");

            const need = new TextInputBuilder()
                .setCustomId("need")
                .setLabel("What do you need help with?")
                .setPlaceholder("Food, utility bill, transportation, etc.")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);

            const amount = new TextInputBuilder()
                .setCustomId("amount")
                .setLabel("Amount needed")
                .setPlaceholder("Example: $50")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50);

            const explanation = new TextInputBuilder()
                .setCustomId("explanation")
                .setLabel("Short explanation")
                .setPlaceholder("Briefly explain your current circumstances.")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000);

            const proof = new TextInputBuilder()
                .setCustomId("proof")
                .setLabel("Proof / evidence link (optional)")
                .setPlaceholder("Paste image link or enter N/A")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(500);

            const payment = new TextInputBuilder()
                .setCustomId("payment")
                .setLabel("Preferred payment method")
                .setPlaceholder("Direct bill, PayPal, bank transfer, etc.")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);

            modal.addComponents(
                new ActionRowBuilder().addComponents(need),
                new ActionRowBuilder().addComponents(amount),
                new ActionRowBuilder().addComponents(explanation),
                new ActionRowBuilder().addComponents(proof),
                new ActionRowBuilder().addComponents(payment)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === "help:form") {
            const data = {
                need: interaction.fields.getTextInputValue("need"),
                amount: interaction.fields.getTextInputValue("amount"),
                explanation: interaction.fields.getTextInputValue("explanation"),
                proof: interaction.fields.getTextInputValue("proof"),
                payment: interaction.fields.getTextInputValue("payment")
            };

            await createHelpTicket(interaction, data);
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith("help:")) {
            if (!interaction.channel?.topic?.startsWith("help-requester:")) {
                await interaction.reply({
                    content: "❌ Error: Invalid ticket channel context.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (!isTeamMember(interaction)) {
                await interaction.reply({
                    content: "❌ Unauthorized: Staff permissions are required.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (interaction.customId === "help:cancel") {
                await interaction.update({
                    content: "✖️ Operation cancelled.",
                    components: []
                }).catch(() => {});
                setTimeout(() => interaction.deleteReply().catch(() => {}), 2500);
                return;
            }

            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const requestMessage = messages.find(
                message =>
                    message.author.id === client.user.id &&
                    message.embeds.length > 0 &&
                    message.embeds[0].title === "❤️ New Community Help Request"
            );
            const currentFooter = requestMessage ? requestMessage.embeds[0].footer?.text || "" : "";

            if (interaction.customId === "help:approve") {
                if (currentFooter.includes("Status: APPROVED")) {
                    await interaction.reply({ content: "⚠️️ Notice: This request is already approved.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await updateStatus(interaction, "APPROVED", "✅", "APPROVED REQUESTS");
                return;
            }

            if (interaction.customId === "help:reject") {
                if (currentFooter.includes("Status: REJECTED")) {
                    await interaction.reply({ content: "⚠️ Notice: This request is already rejected.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await interaction.reply({
                    content: "⚠️ Are you certain you wish to reject this request?",
                    components: [buildConfirmButtons("reject")],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (interaction.customId === "help:reject_confirm") {
                await interaction.update({ content: "✔️ Rejection verified. Processing...", components: [] }).catch(() => {});
                await updateStatus(interaction, "REJECTED", "❌", "REJECTED REQUESTS");
                setTimeout(() => interaction.deleteReply().catch(() => {}), 2000);
                return;
            }

            if (interaction.customId === "help:unapproved") {
                if (currentFooter.includes("Status: PENDING REVIEW")) {
                    await interaction.reply({ content: "⚠️ Notice: This request is already pending.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await updateStatus(interaction, "PENDING REVIEW", "⏳", "HELP REQUESTS");
                return;
            }

            if (interaction.customId === "help:info") {
                const requesterId = interaction.channel.topic.split(":")[1];
                await interaction.channel.send(`<@${requesterId}> 📝 Support staff requires further documentation/information. Please provide clarification in this thread.`);
                await interaction.reply({ content: "✅ Request for additional info dispatched.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (interaction.customId === "help:close") {
                if (currentFooter.includes("Status: CLOSED")) {
                    await interaction.reply({ content: "⚠️ Notice: This ticket is already closed.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await interaction.reply({
                    content: "⚠️ Are you certain you wish to close this ticket?",
                    components: [buildConfirmButtons("close")],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (interaction.customId === "help:close_confirm") {
                await interaction.update({ content: "🔒 Closing ticket...", components: [] }).catch(() => {});
                await closeTicket(interaction);
                setTimeout(() => interaction.deleteReply().catch(() => {}), 2000);
                return;
            }

            if (interaction.customId === "help:reopen") {
                await reopenTicket(interaction);
                return;
            }

            if (interaction.customId === "help:delete") {
                await interaction.reply({
                    content: "⚠️ **WARNING:** This action will permanently delete the channel. Proceed?",
                    components: [buildConfirmButtons("delete")],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (interaction.customId === "help:delete_confirm") {
                await interaction.update({ content: "🗑️ Purging channel data...", components: [] }).catch(() => {});
                setTimeout(() => {
                    interaction.channel.delete().catch(() => {});
                }, 1500);
                return;
            }
        }
    } catch (error) {
        console.error("[ERROR] Unhandled interaction error:", error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "❌ An internal exception occurred while processing this action.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
});

async function updateStatus(interaction, status, emoji, targetCategoryName) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const messages = await interaction.channel.messages.fetch({ limit: 10 });
    const requestMessage = messages.find(
        message =>
            message.author.id === client.user.id &&
            message.embeds.length > 0 &&
            message.embeds[0].title === "❤️ New Community Help Request"
    );

    if (requestMessage) {
        const oldEmbed = requestMessage.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed)
            .setFooter({ text: `Status: ${status} | Updated by ${interaction.user.tag}` });

        await requestMessage.edit({
            embeds: [updatedEmbed],
            components: [buildButtonsForStatus(status)]
        }).catch(() => {});
    }

    const targetCategory = await findOrCreateCategory(interaction.guild, targetCategoryName);
    await interaction.channel.setParent(targetCategory.id).catch(() => {});

    await interaction.channel.send(`${emoji} **Ticket status updated to ${status}.** Handled by: ${interaction.user}`);

    if (interaction.deferred) {
        await interaction.editReply({ content: `✅ Successfully marked as **${status}** and transferred to **${targetCategoryName}**.` });
    }
}

async function closeTicket(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const requesterId = interaction.channel.topic.split(":")[1];

    await interaction.channel.permissionOverwrites.edit(requesterId, {
        ViewChannel: false,
        SendMessages: false
    });

    const closedCategory = await findOrCreateCategory(interaction.guild, "CLOSED REQUESTS");
    await interaction.channel.setParent(closedCategory.id).catch(() => {});

    await interaction.channel.setName(
        interaction.channel.name.startsWith("closed-")
            ? interaction.channel.name
            : `closed-${interaction.channel.name}`.slice(0, 100)
    );

    const messages = await interaction.channel.messages.fetch({ limit: 10 });
    const requestMessage = messages.find(
        message =>
            message.author.id === client.user.id &&
            message.embeds.length > 0 &&
            message.embeds[0].title === "❤️ New Community Help Request"
    );

    if (requestMessage) {
        const oldEmbed = requestMessage.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed)
            .setFooter({ text: `Status: CLOSED | Closed by ${interaction.user.tag}` });

        await requestMessage.edit({
            embeds: [updatedEmbed],
            components: [buildButtonsForStatus("CLOSED")]
        }).catch(() => {});
    }

    await interaction.channel.send(`🔒 This ticket has been closed securely by ${interaction.user}.`);

    if (interaction.deferred) {
        await interaction.editReply({ content: "✅ Ticket closed successfully, moved to archives, and delete option initialized." });
    }
}

async function reopenTicket(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const requesterId = interaction.channel.topic.split(":")[1];

    await interaction.channel.permissionOverwrites.edit(requesterId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true
    });

    const activeCategory = await findOrCreateCategory(interaction.guild, "HELP REQUESTS");
    await interaction.channel.setParent(activeCategory.id).catch(() => {});

    if (interaction.channel.name.startsWith("closed-")) {
        await interaction.channel.setName(interaction.channel.name.replace("closed-", "").slice(0, 100)).catch(() => {});
    }

    const messages = await interaction.channel.messages.fetch({ limit: 10 });
    const requestMessage = messages.find(
        message =>
            message.author.id === client.user.id &&
            message.embeds.length > 0 &&
            message.embeds[0].title === "❤️ New Community Help Request"
    );

    if (requestMessage) {
        const oldEmbed = requestMessage.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed)
            .setFooter({ text: `Status: PENDING REVIEW | Reopened by ${interaction.user.tag}` });

        await requestMessage.edit({
            embeds: [updatedEmbed],
            components: [buildButtonsForStatus("PENDING")]
        }).catch(() => {});
    }

    await interaction.channel.send(`🔓 This support request has been reopened by ${interaction.user}.`);

    if (interaction.deferred) {
        await interaction.editReply({ content: "✅ Ticket successfully restored to active status." });
    }
}

client.login(TOKEN);
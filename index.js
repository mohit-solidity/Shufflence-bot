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
const TEAM_ROLE_NAME = process.env.TEAM_ROLE_NAME || "Owner";

console.log("ENV CHECK:");
console.log("TOKEN exists:", Boolean(process.env.DISCORD_TOKEN));
console.log("TOKEN length:", process.env.DISCORD_TOKEN?.length || 0);
console.log("CLIENT_ID exists:", Boolean(process.env.CLIENT_ID));
console.log("GUILD_ID exists:", Boolean(process.env.GUILD_ID));
console.log("TEAM_ROLE_NAME:", process.env.TEAM_ROLE_NAME);

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error("Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env");
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const commands = [
    new SlashCommandBuilder()
        .setName("setup-help-panel")
        .setDescription("Setup the Community Help panel.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName("close-ticket")
        .setDescription("Close the current help request ticket.")
].map(command => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );

    console.log("✅ Slash commands registered.");
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
        .setTitle("❤️ Community Help")
        .setDescription(
            "Need help with an essential expense?\n\n" +
            "You can submit a private request for things such as:\n\n" +
            "🍔 Food\n" +
            "💡 Bills\n" +
            "🚗 Transportation\n" +
            "🏠 Essential expenses\n" +
            "📦 Other necessary expenses\n\n" +
            "Your request will only be visible to the request team."
        )
        .setFooter({ text: "Please provide accurate information. Requests are reviewed privately." });

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
                .setLabel("Close")
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
                .setEmoji("🗑️️")
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
                .setLabel("Close")
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
            .setLabel("Yes, Confirm")
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
            content: `❌ I couldn't find a role named **${TEAM_ROLE_NAME}**. Create that role and give it to your staff members.`,
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
            content: `❌ You already have an open help request: ${existing}`,
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

    const proofText = data.proof?.trim() ? data.proof.trim() : "No proof/link provided.";

    const embed = new EmbedBuilder()
        .setTitle("❤️ New Community Help Request")
        .setDescription("A member submitted a private help request.\nOnly the requester and members with the Team role can see this channel.")
        .addFields(
            { name: "👤 Discord User", value: `${interaction.user} (\`${interaction.user.tag}\`)` },
            { name: "🆔 Discord ID", value: `\`${interaction.user.id}\`` },
            { name: "🆘 What do they need?", value: data.need },
            { name: "💰 Amount Needed", value: data.amount },
            { name: "📝 Explanation", value: data.explanation },
            { name: "🔗 Proof / Evidence", value: proofText },
            { name: "💳 Payment Method", value: data.payment }
        )
        .setTimestamp()
        .setFooter({ text: "Status: PENDING REVIEW" });

    await channel.send({
        content: `${interaction.user} <@&${teamRole.id}>`,
        embeds: [embed],
        components: [buildButtonsForStatus("PENDING")]
    });

    await interaction.reply({
        content: `✅ Your request was submitted privately: ${channel}`,
        flags: MessageFlags.Ephemeral
    });
}

client.once("ready", async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    try {
        await registerCommands();
    } catch (error) {
        console.error("❌ Failed to register slash commands:", error);
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
                        content: "❌ This command can only be used inside a help-request ticket.",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (!isTeamMember(interaction)) {
                    await interaction.reply({
                        content: "❌ Only Team members can close help requests.",
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
                .setTitle("Community Help Request");

            const need = new TextInputBuilder()
                .setCustomId("need")
                .setLabel("What do you need help with?")
                .setPlaceholder("Food, bill, transportation, etc.")
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
                .setPlaceholder("Briefly explain what happened and why you need help.")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000);

            const proof = new TextInputBuilder()
                .setCustomId("proof")
                .setLabel("Proof / evidence link (if needed)")
                .setPlaceholder("Paste an image/file link, or type N/A")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(500);

            const payment = new TextInputBuilder()
                .setCustomId("payment")
                .setLabel("Preferred payment method")
                .setPlaceholder("Direct bill payment, PayPal, bank transfer, etc.")
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
                    content: "❌ This isn't a help-request ticket.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (!isTeamMember(interaction)) {
                await interaction.reply({
                    content: "❌ Only Team members can use these staff controls.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Handle cancellation for prompt confirmations
            if (interaction.customId === "help:cancel") {
                await interaction.update({
                    content: "❌ Action cancelled.",
                    components: []
                });
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
                    await interaction.reply({ content: "❌ This request is already approved.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await updateStatus(interaction, "APPROVED", "✅", "APPROVED REQUESTS");
                return;
            }

            if (interaction.customId === "help:reject") {
                if (currentFooter.includes("Status: REJECTED")) {
                    await interaction.reply({ content: "❌ This request is already rejected.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await interaction.reply({
                    content: "⚠️ Are you sure you want to reject this request?",
                    components: [buildConfirmButtons("reject")],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (interaction.customId === "help:reject_confirm") {
                await interaction.message.delete().catch(() => {});
                await updateStatus(interaction, "REJECTED", "❌", "REJECTED REQUESTS");
                return;
            }

            if (interaction.customId === "help:unapproved") {
                if (currentFooter.includes("Status: PENDING REVIEW")) {
                    await interaction.reply({ content: "❌ This request is already pending review.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await updateStatus(interaction, "PENDING REVIEW", "⏳", "HELP REQUESTS");
                return;
            }

            if (interaction.customId === "help:info") {
                const requesterId = interaction.channel.topic.split(":")[1];
                await interaction.channel.send(`<@${requesterId}> 📝 The team needs more information before reviewing your request. Please reply here with the missing details or proof.`);
                await interaction.reply({ content: "✅ The requester has been asked for more information.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (interaction.customId === "help:close") {
                if (currentFooter.includes("Status: CLOSED")) {
                    await interaction.reply({ content: "❌ This ticket is already closed.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await interaction.reply({
                    content: "⚠️ Are you sure you want to close this ticket?",
                    components: [buildConfirmButtons("close")],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (interaction.customId === "help:close_confirm") {
                await interaction.message.delete().catch(() => {});
                await closeTicket(interaction);
                return;
            }

            if (interaction.customId === "help:reopen") {
                await reopenTicket(interaction);
                return;
            }

            if (interaction.customId === "help:delete") {
                await interaction.reply({
                    content: "⚠️ Are you sure you want to permanently delete this ticket?",
                    components: [buildConfirmButtons("delete")],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (interaction.customId === "help:delete_confirm") {
                await interaction.reply({ content: "🗑️ Deleting ticket...", flags: MessageFlags.Ephemeral });
                setTimeout(() => {
                    interaction.channel.delete().catch(() => {});
                }, 1000);
                return;
            }
        }
    } catch (error) {
        console.error("Interaction error:", error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "❌ Something went wrong while processing this request.",
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

    await interaction.channel.send(`${emoji} **Request status changed to ${status}.** Staff member: ${interaction.user}`);

    if (interaction.deferred) {
        await interaction.editReply({ content: `✅ Request marked as **${status}** and moved to **${targetCategoryName}**.` });
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

    await interaction.channel.send(`🔒 This help request has been closed by ${interaction.user}.`);

    if (interaction.deferred) {
        await interaction.editReply({ content: "✅ Ticket closed and moved to Closed Requests." });
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

    await interaction.channel.send(`🔓 This help request has been reopened by ${interaction.user}.`);

    if (interaction.deferred) {
        await interaction.editReply({ content: "✅ Ticket reopened and moved back to active status." });
    }
}

client.login(TOKEN);
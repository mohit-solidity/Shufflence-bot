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

if (!TOKEN || !CLIENT_ID || !GUILD_ID) process.exit(1);

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const commands = [
    new SlashCommandBuilder()
        .setName("setup-help-panel")
        .setDescription("Deploy panel.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName("close-ticket")
        .setDescription("Close ticket.")
].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );
}

function isTeamMember(interaction) {
    if (
        interaction.guild.ownerId === interaction.user.id ||
        interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
        return true;
    }

    const role = interaction.guild.roles.cache.find(
        r => r.name === TEAM_ROLE_NAME
    );

    return Boolean(
        role && interaction.member.roles.cache.has(role.id)
    );
}

function getTeamRole(guild) {
    return guild.roles.cache.find(
        r => r.name === TEAM_ROLE_NAME
    );
}

function buildHelpPanel() {
    const embed = new EmbedBuilder()
        .setTitle("❤️ Community Help Panel")
        .setDescription(
            "Need assistance with an essential expense? Click below to submit a private request."
        )
        .setColor(0x5865F2);

    const button = new ButtonBuilder()
        .setCustomId("help:open")
        .setLabel("Send Help Request")
        .setEmoji("📝")
        .setStyle(ButtonStyle.Primary);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(button)
        ]
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
    }

    else if (status === "CLOSED") {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId("help:reopen")
                .setLabel("Reopen")
                .setEmoji("🔓")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("help:delete")
                .setLabel("Delete Ticket")
                .setEmoji("🗑️")
                .setStyle(ButtonStyle.Danger)
        );
    }

    else {
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
            .setLabel("Confirm")
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
    let cat = guild.channels.cache.find(
        c =>
            c.type === ChannelType.GuildCategory &&
            c.name.toLowerCase() === categoryName.toLowerCase()
    );

    if (!cat) {
        cat = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory
        });
    }

    return cat;
}

async function createHelpTicket(interaction, data) {
    const guild = interaction.guild;
    const teamRole = getTeamRole(guild);

    if (!teamRole) {
        return interaction.reply({
            content: `❌ Role **${TEAM_ROLE_NAME}** not found.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const existing = guild.channels.cache.find(
        c =>
            c.type === ChannelType.GuildText &&
            c.topic === `help-requester:${interaction.user.id}`
    );

    if (existing) {
        return interaction.reply({
            content: `❌ You already have an open ticket: ${existing}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const category = await findOrCreateCategory(
        guild,
        "HELP REQUESTS"
    );

    const safeName =
        interaction.user.username
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
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
                    PermissionFlagsBits.ManageMessages
                ]
            }
        ]
    });

    const embed = new EmbedBuilder()
        .setTitle("❤️ New Community Help Request")
        .setDescription("A confidential support ticket has been opened.")
        .setColor(0x5865F2)
        .addFields(
            {
                name: "👤 User",
                value: `${interaction.user} (\`${interaction.user.tag}\`)`
            },
            {
                name: "🆘 Need",
                value: data.need
            },
            {
                name: "💰 Amount",
                value: data.amount
            },
            {
                name: "📝 Explanation",
                value: data.explanation
            },
            {
                name: "🔗 Proof",
                value: data.proof?.trim() || "None"
            },
            {
                name: "💳 Payment",
                value: data.payment
            }
        )
        .setTimestamp()
        .setFooter({
            text: "Status: PENDING REVIEW"
        });

    await channel.send({
        content: `${interaction.user} <@&${teamRole.id}>`,
        embeds: [embed],
        components: [
            buildButtonsForStatus("PENDING")
        ]
    });

    await interaction.reply({
        content: `✅ Ticket created: ${channel}`,
        flags: MessageFlags.Ephemeral
    });
}

client.once("ready", async () => {
    await registerCommands().catch(() => {});
});

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isChatInputCommand()) {

            if (interaction.commandName === "setup-help-panel") {
                return interaction.reply(buildHelpPanel());
            }

            if (interaction.commandName === "close-ticket") {
                if (
                    !interaction.channel?.topic?.startsWith(
                        "help-requester:"
                    )
                ) {
                    return interaction.reply({
                        content: "❌ Not a ticket.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                if (!isTeamMember(interaction)) {
                    return interaction.reply({
                        content: "❌ Unauthorized.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                return closeTicket(interaction);
            }
        }

        if (
            interaction.isButton() &&
            interaction.customId === "help:open"
        ) {
            const modal = new ModalBuilder()
                .setCustomId("help:form")
                .setTitle("Help Request Form");

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("need")
                        .setLabel("What do you need help with?")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),

                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("amount")
                        .setLabel("Amount needed")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),

                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("explanation")
                        .setLabel("Explanation")
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                ),

                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("proof")
                        .setLabel("Proof link (optional)")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                ),

                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("payment")
                        .setLabel("Preferred payment method")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            );

            return interaction.showModal(modal);
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId === "help:form"
        ) {
            const data = {
                need: interaction.fields.getTextInputValue("need"),
                amount: interaction.fields.getTextInputValue("amount"),
                explanation:
                    interaction.fields.getTextInputValue("explanation"),
                proof:
                    interaction.fields.getTextInputValue("proof"),
                payment:
                    interaction.fields.getTextInputValue("payment")
            };

            return createHelpTicket(interaction, data);
        }

        if (
            interaction.isButton() &&
            interaction.customId.startsWith("help:")
        ) {
            if (
                !interaction.channel?.topic?.startsWith(
                    "help-requester:"
                )
            ) {
                return interaction.reply({
                    content: "❌ Invalid context.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!isTeamMember(interaction)) {
                return interaction.reply({
                    content: "❌ Unauthorized.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.customId === "help:cancel") {
                await interaction.deleteReply().catch(() => {});
                return;
            }

            const messages =
                await interaction.channel.messages.fetch({
                    limit: 10
                });

            const reqMsg = messages.find(
                m =>
                    m.author.id === client.user.id &&
                    m.embeds.length > 0 &&
                    m.embeds[0].title ===
                        "❤️ New Community Help Request"
            );

            const footer = reqMsg
                ? reqMsg.embeds[0].footer?.text || ""
                : "";

            if (interaction.customId === "help:approve") {
                if (footer.includes("Status: APPROVED")) {
                    return interaction.reply({
                        content: "⚠️ Already approved.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                return updateStatus(
                    interaction,
                    "APPROVED",
                    "✅",
                    "APPROVED REQUESTS"
                );
            }

            if (interaction.customId === "help:reject") {
                if (footer.includes("Status: REJECTED")) {
                    return interaction.reply({
                        content: "⚠️ Already rejected.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                return interaction.reply({
                    content: "⚠️ Reject this request?",
                    components: [
                        buildConfirmButtons("reject")
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (
                interaction.customId ===
                "help:reject_confirm"
            ) {
                await interaction.update({
                    content: "✔️ Rejecting...",
                    components: []
                }).catch(() => {});

                await updateStatus(
                    interaction,
                    "REJECTED",
                    "❌",
                    "REJECTED REQUESTS"
                );

                await interaction.deleteReply().catch(() => {});
                return;
            }

            if (interaction.customId === "help:unapproved") {
                if (footer.includes("Status: PENDING REVIEW")) {
                    return interaction.reply({
                        content: "⚠️ Already pending.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                return updateStatus(
                    interaction,
                    "PENDING REVIEW",
                    "⏳",
                    "HELP REQUESTS"
                );
            }

            if (interaction.customId === "help:info") {
                const reqId =
                    interaction.channel.topic.split(":")[1];

                await interaction.channel.send(
                    `<@${reqId}> 📝 Team needs more info. Please reply here.`
                );

                return interaction.reply({
                    content: "✅ Asked for info.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.customId === "help:close") {
                if (footer.includes("Status: CLOSED")) {
                    return interaction.reply({
                        content: "⚠️ Already closed.",
                        flags: MessageFlags.Ephemeral
                    });
                }

                return interaction.reply({
                    content: "⚠️ Close this ticket?",
                    components: [
                        buildConfirmButtons("close")
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (
                interaction.customId ===
                "help:close_confirm"
            ) {
                await interaction.update({
                    content: "🔒 Closing...",
                    components: []
                }).catch(() => {});

                await closeTicket(interaction);

                await interaction.deleteReply().catch(() => {});
                return;
            }

            if (interaction.customId === "help:reopen") {
                return reopenTicket(interaction);
            }

            if (interaction.customId === "help:delete") {
                return interaction.reply({
                    content: "⚠️ Permanently delete this ticket?",
                    components: [
                        buildConfirmButtons("delete")
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (
                interaction.customId ===
                "help:delete_confirm"
            ) {
                await interaction.update({
                    content: "🗑️ Deleting...",
                    components: []
                }).catch(() => {});

                await interaction.deleteReply().catch(() => {});

                await interaction.channel
                    .delete()
                    .catch(() => {});

                return;
            }
        }
    }

    catch (err) {
        if (
            !interaction.replied &&
            !interaction.deferred
        ) {
            await interaction.reply({
                content: "❌ Error processing request.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
});

async function updateStatus(
    interaction,
    status,
    emoji,
    catName
) {
    if (
        !interaction.deferred &&
        !interaction.replied
    ) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    const messages =
        await interaction.channel.messages.fetch({
            limit: 10
        });

    const reqMsg = messages.find(
        m =>
            m.author.id === client.user.id &&
            m.embeds.length > 0 &&
            m.embeds[0].title ===
                "❤️ New Community Help Request"
    );

    if (reqMsg) {
        const newEmbed =
            EmbedBuilder
                .from(reqMsg.embeds[0])
                .setFooter({
                    text: `Status: ${status} | By ${interaction.user.tag}`
                });

        await reqMsg.edit({
            embeds: [newEmbed],
            components: [
                buildButtonsForStatus(status)
            ]
        }).catch(() => {});
    }

    const cat = await findOrCreateCategory(
        interaction.guild,
        catName
    );

    await interaction.channel
        .setParent(cat.id)
        .catch(() => {});

    await interaction.channel.send(
        `${emoji} Status updated to **${status}** by ${interaction.user}`
    );

    if (interaction.deferred) {
        await interaction.editReply({
            content: `✅ Updated to **${status}**.`
        });
    }
}

async function closeTicket(interaction) {
    if (
        !interaction.deferred &&
        !interaction.replied
    ) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    const reqId =
        interaction.channel.topic.split(":")[1];

    await interaction.channel.permissionOverwrites.edit(
        reqId,
        {
            ViewChannel: false,
            SendMessages: false
        }
    );

    const cat = await findOrCreateCategory(
        interaction.guild,
        "CLOSED REQUESTS"
    );

    await interaction.channel
        .setParent(cat.id)
        .catch(() => {});

    if (
        !interaction.channel.name.startsWith("closed-")
    ) {
        await interaction.channel
            .setName(
                `closed-${interaction.channel.name}`
            )
            .then(() => {})
            .catch(() => {});
    }

    const messages =
        await interaction.channel.messages.fetch({
            limit: 10
        });

    const reqMsg = messages.find(
        m =>
            m.author.id === client.user.id &&
            m.embeds.length > 0 &&
            m.embeds[0].title ===
                "❤️ New Community Help Request"
    );

    if (reqMsg) {
        const newEmbed =
            EmbedBuilder
                .from(reqMsg.embeds[0])
                .setFooter({
                    text: `Status: CLOSED | By ${interaction.user.tag}`
                });

        await reqMsg.edit({
            embeds: [newEmbed],
            components: [
                buildButtonsForStatus("CLOSED")
            ]
        }).catch(() => {});
    }

    await interaction.channel.send(
        `🔒 Closed by ${interaction.user}.`
    );

    if (interaction.deferred) {
        await interaction.editReply({
            content: "✅ Ticket closed."
        });
    }
}

async function reopenTicket(interaction) {
    if (
        !interaction.deferred &&
        !interaction.replied
    ) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    const reqId =
        interaction.channel.topic.split(":")[1];

    await interaction.channel.permissionOverwrites.edit(
        reqId,
        {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true
        }
    );

    const cat = await findOrCreateCategory(
        interaction.guild,
        "HELP REQUESTS"
    );

    await interaction.channel
        .setParent(cat.id)
        .catch(() => {});

    if (
        interaction.channel.name.startsWith("closed-")
    ) {
        await interaction.channel
            .setName(
                interaction.channel.name.replace(
                    "closed-",
                    ""
                )
            )
            .catch(() => {});
    }

    const messages =
        await interaction.channel.messages.fetch({
            limit: 10
        });

    const reqMsg = messages.find(
        m =>
            m.author.id === client.user.id &&
            m.embeds.length > 0 &&
            m.embeds[0].title ===
                "❤️ New Community Help Request"
    );

    if (reqMsg) {
        const newEmbed =
            EmbedBuilder
                .from(reqMsg.embeds[0])
                .setFooter({
                    text: `Status: PENDING REVIEW | By ${interaction.user.tag}`
                });

        await reqMsg.edit({
            embeds: [newEmbed],
            components: [
                buildButtonsForStatus("PENDING")
            ]
        }).catch(() => {});
    }

    await interaction.channel.send(
        `🔓 Reopened by ${interaction.user}.`
    );

    if (interaction.deferred) {
        await interaction.editReply({
            content: "✅ Ticket reopened."
        });
    }
}

client.login(TOKEN);
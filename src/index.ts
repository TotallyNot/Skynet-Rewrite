import "reflect-metadata";

import { Client, Intents } from "discord.js";
import { createConnection, getCustomRepository } from "typeorm";

import glob from "glob";
import path from "path";

import { config } from "./config";

import * as decoratorData from "./decorators/data";
import { makeLogger } from "./logger";

import { CommandRepository } from "./repository/CommandRepository";

const logger = makeLogger(module);

logger.info("Starting bot");

const client = new Client({
    intents: [Intents.FLAGS.GUILDS],
});

// load handlers...
glob.sync("dist/handler/**/*.js").forEach((match) => {
    const file = path.relative("src", match);
    require("./" + file);
});

client.on("ready", async (client) => {
    await createConnection({
        type: "postgres",
        host: config.databaseHost,
        port: config.databasePort,
        username: config.databaseUser,
        password: config.databasePassword,
        database: config.databaseName,
        synchronize: true,
        entities: ["dist/entity/**/*.js"],
        migrations: ["dist/migration/**/*.js"],
    });

    if (config.updateGlobals && !config.debug) {
        try {
            const data = [...decoratorData.globalCommandsData].map((factory) =>
                factory()
            );
            await client.application.commands.set(data).then(console.log);
            logger.info("Updated application commands");
        } catch (e) {
            logger.error(
                "Unexpected error while updating global commands: %O",
                e
            );
        }
    }

    if (config.updateGuilds) {
        const guilds = await client.guilds.fetch();
        const commandRepository = getCustomRepository(CommandRepository);
        for (const partialGuild of guilds.values()) {
            try {
                const guild = await partialGuild.fetch();
                const data = [...decoratorData.guildCommandsData].map(
                    (factory) => factory()
                );
                if (config.debug) {
                    data.push(
                        ...[...decoratorData.globalCommandsData].map(
                            (factory) => factory()
                        )
                    );
                }

                const commands = await guild.commands.set(data);
                await commandRepository.replaceGuildCommands(
                    commands,
                    partialGuild.id
                );

                await Promise.all(
                    [...decoratorData.updateHooks].map((hook) => hook(guild))
                );
            } catch (e) {
                logger.error(
                    "Unexpected error after trying to join guild <id=%s>: %O",
                    partialGuild.id,
                    e
                );
            }
        }
        logger.info("Updated guild commands");
    }

    logger.info("Bot is ready");
});

client.on("guildCreate", async (guild) => {
    try {
        const data = [...decoratorData.guildCommandsData].map((factory) =>
            factory()
        );
        if (config.debug) {
            data.push(
                ...[...decoratorData.globalCommandsData].map((factory) =>
                    factory()
                )
            );
        }

        const commands = await guild.commands.set(data);

        const commandRepository = getCustomRepository(CommandRepository);
        await commandRepository.replaceGuildCommands(commands, guild.id);
    } catch (e) {
        logger.error(
            "Unexpected error after trying to join guild <id=%s>: %O",
            guild.id,
            e
        );
    }
});

client.on("interactionCreate", async (interaction) => {
    if (interaction.isCommand()) {
        logger.debug("Received command '%s'", interaction.commandName);
        await decoratorData.commands.get(interaction.commandName)?.(
            interaction
        );
    }
    if (interaction.isButton()) {
        logger.debug(
            "Received button interaction for '%s'",
            interaction.customId
        );
        await decoratorData.buttons.get(interaction.customId)?.(interaction);
    }
});

for (const event in decoratorData.eventHandlers) {
    client.on(event, async (...args) => {
        try {
            await Promise.all(
                /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                (decoratorData.eventHandlers as any)[event].map(
                    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                    (handler: any) => handler(args)
                )
            );
        } catch (e) {
            logger.error("Error in event handler '%s': %O", event, e);
        }
    });
}

client.login(config.botToken);

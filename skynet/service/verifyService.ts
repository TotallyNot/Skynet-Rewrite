import {
    Collection,
    GuildMember,
    EmbedBuilder,
    OAuth2Guild,
    ChannelType,
    DiscordAPIError,
} from "discord.js";
import { Guild as GuildEntity } from "../entity/Guild";

import { Team } from "../service/util/constants";
import { getNicknameIfChanged } from "./nicknameService";
import { UserData } from "../wrapper/models/user";
import { ApiError, BotError } from "../error";
import { AppDataSource } from "..";
import { makeLogger } from "../logger";
import { Color } from "../service/util/constants";
import { UserRank } from "../entity/UserRank";
import { ApiWrapper } from "../wrapper/wrapper";
import { UserRankRepository } from "../repository/UserRankRepository";

const logger = makeLogger(import.meta);

export async function updateRoleAndNickname(
    user: UserData,
    guild: GuildEntity,
    member: GuildMember,
    isRoundOver: boolean
): Promise<void> {
    if (!guild.allies_role || !guild.axis_role || !guild.spectator_role)
        throw new BotError("Roles are not configured for this guild");

    const map = {
        [Team.ALLIES]: guild.allies_role,
        [Team.AXIS]: guild.axis_role,
        [Team.AUTO]: guild.auto_role ?? guild.spectator_role,
        [Team.NONE]: guild.spectator_role,
    };

    const blockTeamRoles = isRoundOver || !guild.roles_enabled;

    const roles = getRolesIfChanged(
        user,
        member,
        map,
        blockTeamRoles,
        guild.verified_role
    );
    const nick = await getNicknameIfChanged(member, user, isRoundOver);

    if (roles || nick) {
        await member.edit({ roles, nick });
    }

    if (nick) {
        // TODO: this should probably be merged with the role update for rank roles?
        try {
            await UserRankRepository.updateNameAndRank(
                member.id,
                user.rank,
                user.name
            );
        } catch (e) {
            console.error(e);
        }
    }
}

export async function resetMember(
    member: GuildMember,
    guild: GuildEntity
): Promise<void> {
    const newRoles = member.roles.cache.filter(
        (_v, k) =>
            k !== guild.allies_role &&
            k !== guild.axis_role &&
            k !== guild.spectator_role &&
            k !== guild.verified_role
    );

    if (member.manageable) {
        if (
            newRoles.difference(member.roles.cache).size !== 0 ||
            member.nickname !== null
        ) {
            await member.edit({ roles: newRoles, nick: null });
        }
    } else if (newRoles.difference(member.roles.cache).size !== 0) {
        await member.edit({ roles: newRoles });
    }
}

export function getRolesIfChanged(
    user: UserData,
    member: GuildMember,
    roleMap: Record<Team, string>,
    blockTeamRoles: boolean,
    verified?: string
): string[] | undefined {
    const has = blockTeamRoles ? [roleMap[Team.NONE]] : [roleMap[user.team]];
    if (verified) {
        has.push(verified);
    }

    const hasNot = blockTeamRoles
        ? [roleMap[Team.ALLIES], roleMap[Team.AXIS]]
        : [];
    if (!blockTeamRoles) {
        switch (user.team) {
            case Team.ALLIES:
                hasNot.push(
                    roleMap[Team.AXIS],
                    roleMap[Team.AUTO],
                    roleMap[Team.NONE]
                );
                break;
            case Team.AXIS:
                hasNot.push(
                    roleMap[Team.ALLIES],
                    roleMap[Team.AUTO],
                    roleMap[Team.NONE]
                );
                break;
            case Team.NONE:
                hasNot.push(
                    roleMap[Team.AXIS],
                    roleMap[Team.ALLIES],
                    roleMap[Team.AUTO]
                );
                break;
            case Team.AUTO:
                hasNot.push(
                    roleMap[Team.AXIS],
                    roleMap[Team.ALLIES],
                    roleMap[Team.NONE]
                );
                break;
        }
    }

    if (
        member.roles.cache.hasAny(...hasNot) ||
        !member.roles.cache.hasAll(...has)
    ) {
        const combined = new Set([...has, ...hasNot]);
        const otherRoles = member.roles.cache
            .filter((_v, k) => !combined.has(k))
            .keys();

        return [...new Set([...has, ...otherRoles])];
    }
}

export async function getGuild(guildId: string): Promise<GuildEntity> {
    const guildRepository = AppDataSource.getRepository(GuildEntity);
    return await guildRepository.findOneOrFail({
        where: { guild_id: guildId },
    });
}

export async function sendMessage(
    member: GuildMember,
    message: string,
    color: Color
) {
    const guild = await getGuild(member.guild.id);
    const embed = new EmbedBuilder()
        .setAuthor({
            name: member.displayName,
            iconURL: member.user.displayAvatarURL(),
        })
        .setDescription(message)
        .setColor(color);

    const verifyChannel = getVerifyChannel(member, guild);

    if (verifyChannel && verifyChannel.type === ChannelType.GuildText) {
        await verifyChannel.send({ embeds: [embed] });
    }
}

function getVerifyChannel(member: GuildMember, guild: GuildEntity) {
    return guild.verify_channel
        ? member.guild.channels.cache.get(guild.verify_channel)
        : undefined;
}

export async function processUser(
    u: UserRank,
    guilds: Collection<string, OAuth2Guild>,
    isRoundOver: boolean
): Promise<void> {
    try {
        const user = await ApiWrapper.bot.getUser(u.discord_id);
        for (const g of u.guild_ids) {
            const guild = await guilds.get(g)?.fetch();
            if (guild) {
                const guildEntity = await getGuild(guild.id);
                try {
                    const member = await guild.members.fetch(u.discord_id);
                    await updateRoleAndNickname(
                        user,
                        guildEntity,
                        member,
                        isRoundOver
                    );
                } catch (e) {
                    if (e instanceof DiscordAPIError && e.code === 10007) {
                        u.guild_ids = u.guild_ids.filter((i) => i !== guild.id);
                        if (u.guild_ids.length === 0) {
                            await AppDataSource.manager.delete(UserRank, u);
                        } else {
                            await AppDataSource.manager.update(
                                UserRank,
                                { where: { id: u.id } },
                                { guild_ids: u.guild_ids }
                            );
                        }
                    } else {
                        logger.debug(e);
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof ApiError && e.code === 2) {
            for (const i of u.guild_ids) {
                const guild = await guilds.get(i)?.fetch();
                if (!guild) continue;
                const guildEntity = await getGuild(i);
                const member = await guild.members.fetch(u.discord_id);

                await resetMember(member, guildEntity);
            }

            await UserRankRepository.deleteById(u.discord_id);
        } else {
            logger.debug(e);
        }
    }
}

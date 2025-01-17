import { UserSettings } from "../entity/UserSettings";
import { Team } from "../service/util/constants";

import { AppDataSource } from "../";

export enum Toggles {
    WAR = "war_flag",
    QUEUE = "queue_flag",
    MAIL = "mail_flag",
    EVENT = "event_flag",
    ENEMY = "enemy_flag",
    REIMB = "reimb_flag",
    PAUSED = "paused_flag",
}

export interface Timers {
    prev_war_notification?: Date;
    prev_queue_notification?: Date;
    prev_reimb_notification?: Date;
}

export interface Counts {
    prev_num_mails?: number;
    prev_num_events?: number;
}

export const UserSettingsRepository = AppDataSource.getRepository(
    UserSettings
).extend({
    updateSetting(discordId: string, toggle: Toggles, value: boolean) {
        return this.manager.update(UserSettings, discordId, {
            [toggle]: value,
        });
    },

    async updateTimersAndCounts(
        discord_id: string,
        timers: Timers,
        counts: Counts
    ): Promise<void> {
        if (
            Object.keys(timers).length === 0 &&
            Object.keys(counts).length === 0
        ) {
            return;
        }

        await this.manager.save(UserSettings, {
            discord_id,
            ...timers,
            ...counts,
        });
    },

    getUserByDiscordId(discord_id: string) {
        return this.manager.findOne(UserSettings, { where: { discord_id } });
    },

    updateCountryAndEnemyCount(
        discordId: string,
        country: number,
        enemy_count: number,
        notif_time?: Date
    ) {
        return this.manager.update(UserSettings, discordId, {
            prev_num_enemies: enemy_count,
            country: country,
            prev_enemies_notification: notif_time,
        });
    },

    getAllUserSettings() {
        return this.manager.find(UserSettings);
    },

    saveSettings(
        discordId: string,
        apiKey: string,
        validKey: boolean,
        userId: number,
        team?: Team
    ) {
        const notificationSettings = new UserSettings();
        notificationSettings.discord_id = discordId;
        notificationSettings.api_key = apiKey;
        notificationSettings.valid_key = validKey;
        notificationSettings.user_id = userId;
        notificationSettings.team = team;
        return this.manager.save(notificationSettings);
    },
    deleteByDiscordId(discordId: string) {
        return this.manager.delete(UserSettings, discordId);
    },
});

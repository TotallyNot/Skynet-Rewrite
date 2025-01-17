import { Client } from "discord.js";
import { ScheduledJob, Cron } from "../../decorators";
import { makeLogger } from "../../logger";
import { ReminderRepository } from "../../repository/ReminderRepository";
import { processReminder } from "../../service/reminders";
import { isSome } from "../../util/guard";

const logger = makeLogger(import.meta);

@ScheduledJob()
export class MonitorReminders {
    @Cron({ cron: "*/30 * * * * *", label: "monitor_reminders" })
    async checkReminders(client: Client) {
        try {
            const reminders = await ReminderRepository.getReminders(new Date());

            if (reminders.length > 0) {
                const result = await Promise.all(
                    reminders.map(async (reminder) => {
                        return await processReminder(reminder, client);
                    })
                );
                const remindersToDelete = result.filter(isSome);

                await ReminderRepository.delete(remindersToDelete);
            }
        } catch (e) {
            logger.error(e);
        }
    }
}

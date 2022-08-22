import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity()
export class Guild {
    @PrimaryColumn({ type: "char", length: 19 })
    guild_id!: string;

    @Column({ type: "char", length: 19, nullable: true })
    allies_role?: string;

    @Column({ type: "char", length: 19, nullable: true })
    axis_role?: string;

    @Column({ type: "char", length: 19, nullable: true })
    verified_role?: string;

    @Column({ type: "char", length: 19, nullable: true })
    spectator_role?: string;

    @Column({ type: "char", length: 19, nullable: true })
    log_channel?: string;

    @Column({ type: "char", length: 19, nullable: true })
    verify_channel?: string;

    @Column({ type: "char", length: 19, array: true })
    command_channels!: string[];

    @Column({ type: "char", length: 19, nullable: true })
    troop_movement_channel?: string;

    @Column({ type: "char", length: 19, nullable: true })
    land_facility_channel?: string;
}

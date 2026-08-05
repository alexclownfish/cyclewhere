import { z } from "zod";
import { difficultyLevels } from "../../domain/models.js";

const isoDate = z.iso.datetime({ offset: true });

export const createEventSchema = z
  .object({
    routeId: z.string().trim().min(1).max(100).nullable().default(null),
    title: z.string().trim().min(2).max(80),
    summary: z.string().trim().min(10).max(1000),
    startAt: isoDate,
    registrationDeadline: isoDate,
    meetingPoint: z.string().trim().min(2).max(200),
    difficulty: z.enum(difficultyLevels),
    distanceKm: z.number().positive().max(1000),
    elevationGainM: z.number().nonnegative().max(30000),
    speedMinKph: z.number().positive().max(100),
    speedMaxKph: z.number().positive().max(100),
    capacity: z.number().int().min(1).max(1000),
    equipmentRequirements: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
    abilityRequirements: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
    safetyNotice: z.string().trim().min(10).max(2000),
  })
  .superRefine((data, context) => {
    if (Date.parse(data.registrationDeadline) >= Date.parse(data.startAt)) {
      context.addIssue({
        code: "custom",
        path: ["registrationDeadline"],
        message: "报名截止时间必须早于活动开始时间",
      });
    }
    if (data.speedMinKph > data.speedMaxKph) {
      context.addIssue({
        code: "custom",
        path: ["speedMinKph"],
        message: "最低速度不能高于最高速度",
      });
    }
  });

export const eventListQuerySchema = z.object({
  status: z.enum(["published", "full", "completed"]).optional(),
  difficulty: z.enum(difficultyLevels).optional(),
  cursor: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

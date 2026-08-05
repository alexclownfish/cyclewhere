import { z } from "zod";
import { difficultyLevels } from "../../domain/models.js";

const waypointSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["start", "finish", "water", "supply", "danger", "viewpoint"]),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  distanceKm: z.number().nonnegative().max(1000),
});

const trackPointSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

export const createRoadbookSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(1000),
  distanceKm: z.number().positive().max(1000),
  elevationGainM: z.number().nonnegative().max(30000),
  estimatedMinutes: z.number().int().positive().max(10080),
  difficulty: z.enum(difficultyLevels),
  region: z.string().trim().min(2).max(100),
  track: z.array(trackPointSchema).min(2).max(5000),
  elevationProfile: z.array(z.number().nonnegative().max(10000)).min(2).max(5000),
  maxGradient: z.number().nonnegative().max(100),
  waypoints: z.array(waypointSchema).min(2).max(500),
}).superRefine((data, context) => {
  if (data.elevationProfile.length !== data.track.length) {
    context.addIssue({ code: "custom", path: ["elevationProfile"], message: "海拔点数量必须与轨迹点一致" });
  }
});

export const roadbookListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateRoadbookInput = z.infer<typeof createRoadbookSchema>;

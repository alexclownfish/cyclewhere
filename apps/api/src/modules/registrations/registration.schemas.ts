import { z } from "zod";

export const registerSchema = z.object({
  phone: z.string().trim().regex(/^1\d{10}$/, "请输入有效的中国大陆手机号"),
  emergencyContact: z.string().trim().min(4).max(100),
  bikeType: z.string().trim().min(2).max(30),
  abilityConfirmed: z.literal(true),
  equipmentConfirmed: z.literal(true),
  waiverVersion: z.string().trim().regex(/^v\d+(?:\.\d+)*$/).max(30),
});

export type RegisterInput = z.infer<typeof registerSchema>;

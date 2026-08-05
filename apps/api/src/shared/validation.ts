import { z } from "zod";
import { DomainError } from "../domain/errors.js";

export const idSchema = z.string().trim().min(1).max(100);

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new DomainError("VALIDATION_ERROR", "请求参数不合法", 400, result.error.flatten());
  }
  return result.data;
}

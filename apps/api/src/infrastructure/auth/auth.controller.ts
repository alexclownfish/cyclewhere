import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { DomainError } from "../../domain/errors.js";
import { parseInput } from "../../shared/validation.js";
import { AuthService } from "./auth.service.js";

const loginSchema = z.object({ code: z.string().trim().min(6).max(256) }).strict();

class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStartedAt: number }>();

  check(key: string, now = Date.now()) {
    const current = this.attempts.get(key);
    if (!current || now - current.windowStartedAt >= 60_000) {
      this.attempts.set(key, { count: 1, windowStartedAt: now });
      return;
    }
    if (current.count >= 20) throw new DomainError("RATE_LIMITED", "登录请求过于频繁", 429);
    current.count += 1;
  }
}

@Controller("auth/wechat")
export class AuthController {
  private readonly limiter = new LoginRateLimiter();

  constructor(@Inject(AuthService) private readonly service: AuthService) {}

  @Post("login")
  async login(@Body() body: unknown, @Req() request: FastifyRequest) {
    this.limiter.check(request.ip);
    const input = parseInput(loginSchema, body);
    return { data: await this.service.login(input.code) };
  }
}

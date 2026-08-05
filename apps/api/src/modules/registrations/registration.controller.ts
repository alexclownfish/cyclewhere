import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DomainError } from "../../domain/errors.js";
import { JwtAuthGuard } from "../../infrastructure/auth/auth.guards.js";
import type { AuthenticatedRequest } from "../../infrastructure/auth/auth.types.js";
import { idSchema, parseInput } from "../../shared/validation.js";
import { registerSchema } from "./registration.schemas.js";
import { RegistrationService } from "./registration.service.js";

@Controller("events/:id")
@UseGuards(JwtAuthGuard)
export class RegistrationController {
  constructor(@Inject(RegistrationService) private readonly service: RegistrationService) {}

  @Post("registrations")
  async register(
    @Param("id") rawEventId: string,
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new DomainError(
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key 长度应为 8 至 128",
        400,
      );
    }
    const result = await this.service.register(
      parseInput(idSchema, rawEventId),
      request.user.id,
      idempotencyKey,
      parseInput(registerSchema, body),
    );
    reply.code(result.replayed ? 200 : 201);
    return { data: result };
  }

  @Delete("registrations/me")
  @HttpCode(200)
  async cancel(
    @Param("id") rawEventId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.service.cancel(parseInput(idSchema, rawEventId), request.user.id),
    };
  }

  @Get("registration-status")
  async status(
    @Param("id") rawEventId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.service.getStatus(
        parseInput(idSchema, rawEventId),
        request.user.id,
      ),
    };
  }
}

@Controller("me")
@UseGuards(JwtAuthGuard)
export class MyRegistrationController {
  constructor(@Inject(RegistrationService) private readonly service: RegistrationService) {}

  @Get("registrations")
  async list(@Req() request: AuthenticatedRequest) {
    return { data: { items: await this.service.listMine(request.user.id) } };
  }
}

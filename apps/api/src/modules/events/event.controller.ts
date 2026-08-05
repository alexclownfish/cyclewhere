import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, OptionalJwtAuthGuard } from "../../infrastructure/auth/auth.guards.js";
import type { AuthenticatedRequest, OptionallyAuthenticatedRequest } from "../../infrastructure/auth/auth.types.js";
import { idSchema, parseInput } from "../../shared/validation.js";
import { createEventSchema, eventListQuerySchema } from "./event.schemas.js";
import { EventService } from "./event.service.js";

@Controller("events")
export class EventController {
  constructor(@Inject(EventService) private readonly service: EventService) {}

  @Get()
  async list(@Query() rawQuery: unknown) {
    const query = parseInput(eventListQuerySchema, rawQuery);
    return {
      data: await this.service.list({
        limit: query.limit,
        ...(query.status ? { status: query.status } : {}),
        ...(query.difficulty ? { difficulty: query.difficulty } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
      }),
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return { data: await this.service.create(request.user.id, parseInput(createEventSchema, body)) };
  }

  @Get(":id")
  @UseGuards(OptionalJwtAuthGuard)
  async get(@Param("id") rawId: string, @Req() request: OptionallyAuthenticatedRequest) {
    return { data: await this.service.getPublic(parseInput(idSchema, rawId), request.user?.id) };
  }

  @Post(":id/publish")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async publish(@Param("id") rawId: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.service.publish(parseInput(idSchema, rawId), request.user.id) };
  }
}

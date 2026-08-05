import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../infrastructure/auth/auth.guards.js";
import type { AuthenticatedRequest } from "../../infrastructure/auth/auth.types.js";
import { idSchema, parseInput } from "../../shared/validation.js";
import { createRoadbookSchema, roadbookListQuerySchema } from "./roadbook.schemas.js";
import { RoadbookService } from "./roadbook.service.js";

@Controller("routes")
export class RoadbookController {
  constructor(@Inject(RoadbookService) private readonly service: RoadbookService) {}

  @Get()
  async list(@Query() rawQuery: unknown) {
    const query = parseInput(roadbookListQuerySchema, rawQuery);
    const page = query.cursor
      ? await this.service.list(query.limit, query.cursor)
      : await this.service.list(query.limit);
    return { data: page };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return { data: await this.service.create(request.user.id, parseInput(createRoadbookSchema, body)) };
  }

  @Get(":id")
  async get(@Param("id") rawId: string) {
    return { data: await this.service.get(parseInput(idSchema, rawId)) };
  }
}

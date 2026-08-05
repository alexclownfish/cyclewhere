import { randomUUID } from "node:crypto";
import { forbidden, invalidState, notFound } from "../../domain/errors.js";
import type { CyclingEvent } from "../../domain/models.js";
import type { EventListQuery, Repository } from "../../domain/repository.js";
import type { CreateEventInput } from "./event.schemas.js";

export class EventService {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date,
  ) {}

  list(query: EventListQuery) {
    return this.repository.listEvents(query);
  }

  async get(id: string): Promise<CyclingEvent> {
    const event = await this.repository.getEvent(id);
    if (!event) throw notFound("活动");
    return event;
  }

  async getPublic(id: string, viewerId?: string): Promise<CyclingEvent> {
    const event = await this.get(id);
    const isPublic = event.status === "published" || event.status === "full" || event.status === "completed";
    if (!isPublic && event.organizerId !== viewerId) throw notFound("活动");
    return event;
  }

  async create(organizerId: string, input: CreateEventInput): Promise<CyclingEvent> {
    if (input.routeId && !(await this.repository.getRoadbook(input.routeId))) {
      throw notFound("路书");
    }
    const now = this.clock().toISOString();
    return this.repository.createEvent({
      id: randomUUID(),
      organizerId,
      ...input,
      registrationCount: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }

  async publish(id: string, organizerId: string): Promise<CyclingEvent> {
    const event = await this.get(id);
    if (event.organizerId !== organizerId) throw forbidden("仅活动组织者可以发布活动");
    if (event.status !== "draft") throw invalidState("只有草稿活动可以发布");
    if (this.clock().getTime() >= Date.parse(event.registrationDeadline)) {
      throw invalidState("报名截止时间已过，无法发布");
    }
    const now = this.clock().toISOString();
    return this.repository.updateEvent({
      ...event,
      status: "published",
      updatedAt: now,
      version: event.version + 1,
    });
  }
}

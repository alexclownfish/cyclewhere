import { randomUUID } from "node:crypto";
import { notFound } from "../../domain/errors.js";
import type { Repository } from "../../domain/repository.js";
import type { CreateRoadbookInput } from "./roadbook.schemas.js";

export class RoadbookService {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date,
  ) {}

  list(limit: number, cursor?: string) {
    return this.repository.listRoadbooks(limit, cursor);
  }

  async get(id: string) {
    const roadbook = await this.repository.getRoadbook(id);
    if (!roadbook) throw notFound("路书");
    return roadbook;
  }

  create(ownerId: string, input: CreateRoadbookInput) {
    const now = this.clock().toISOString();
    return this.repository.createRoadbook({
      id: randomUUID(),
      ownerId,
      ...input,
      coordinateSystem: "WGS84",
      createdAt: now,
      updatedAt: now,
    });
  }
}

import { Module } from "@nestjs/common";
import type { Repository } from "../../domain/repository.js";
import { CLOCK, REPOSITORY } from "../../infrastructure/core.module.js";
import { RoadbookController } from "./roadbook.controller.js";
import { RoadbookService } from "./roadbook.service.js";

@Module({
  controllers: [RoadbookController],
  providers: [
    {
      provide: RoadbookService,
      inject: [REPOSITORY, CLOCK],
      useFactory: (repository: Repository, clock: () => Date) =>
        new RoadbookService(repository, clock),
    },
  ],
})
export class RoadbookModule {}

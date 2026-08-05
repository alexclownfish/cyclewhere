import { Module } from "@nestjs/common";
import type { Repository } from "../../domain/repository.js";
import { CLOCK, REPOSITORY } from "../../infrastructure/core.module.js";
import { EventController } from "./event.controller.js";
import { EventService } from "./event.service.js";

@Module({
  controllers: [EventController],
  providers: [
    {
      provide: EventService,
      inject: [REPOSITORY, CLOCK],
      useFactory: (repository: Repository, clock: () => Date) => new EventService(repository, clock),
    },
  ],
})
export class EventModule {}

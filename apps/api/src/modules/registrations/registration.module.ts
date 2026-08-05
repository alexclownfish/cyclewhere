import { Module } from "@nestjs/common";
import type { Repository } from "../../domain/repository.js";
import { CLOCK, FIELD_ENCRYPTOR, REPOSITORY } from "../../infrastructure/core.module.js";
import type { FieldEncryptor } from "../../infrastructure/field-encryptor.js";
import { MyRegistrationController, RegistrationController } from "./registration.controller.js";
import { RegistrationService } from "./registration.service.js";

@Module({
  controllers: [RegistrationController, MyRegistrationController],
  providers: [
    {
      provide: RegistrationService,
      inject: [REPOSITORY, CLOCK, FIELD_ENCRYPTOR],
      useFactory: (repository: Repository, clock: () => Date, encryptor: FieldEncryptor) =>
        new RegistrationService(repository, clock, encryptor),
    },
  ],
})
export class RegistrationModule {}

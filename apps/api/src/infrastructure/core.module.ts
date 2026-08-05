import { DynamicModule, Global, Module } from "@nestjs/common";
import type { Repository } from "../domain/repository.js";
import type { FieldEncryptor } from "./field-encryptor.js";

export const REPOSITORY = Symbol("REPOSITORY");
export const CLOCK = Symbol("CLOCK");
export const FIELD_ENCRYPTOR = Symbol("FIELD_ENCRYPTOR");

export interface CoreModuleOptions {
  repository: Repository;
  clock: () => Date;
  fieldEncryptor: FieldEncryptor;
}

@Global()
@Module({})
export class CoreModule {
  static register(options: CoreModuleOptions): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: REPOSITORY, useValue: options.repository },
        { provide: CLOCK, useValue: options.clock },
        { provide: FIELD_ENCRYPTOR, useValue: options.fieldEncryptor },
      ],
      exports: [REPOSITORY, CLOCK, FIELD_ENCRYPTOR],
    };
  }
}

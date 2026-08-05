import "reflect-metadata";
import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Module,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyReply } from "fastify";
import { DomainError } from "./domain/errors.js";
import type { Repository } from "./domain/repository.js";
import { AuthModule } from "./infrastructure/auth/auth.module.js";
import type { WeChatSessionGateway } from "./infrastructure/auth/wechat-session.gateway.js";
import { CoreModule } from "./infrastructure/core.module.js";
import { FieldEncryptor } from "./infrastructure/field-encryptor.js";
import { EventModule } from "./modules/events/event.module.js";
import { RegistrationModule } from "./modules/registrations/registration.module.js";
import { RoadbookModule } from "./modules/roadbooks/roadbook.module.js";

@Controller("health")
class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details ?? null },
      });
    }
    if (error instanceof HttpException) {
      const statusCode = error.getStatus();
      const response = error.getResponse();
      const message =
        typeof response === "string"
          ? response
          : String((response as { message?: string | string[] }).message ?? error.message);
      return reply.code(statusCode).send({
        error: {
          code: statusCode === 401 ? "UNAUTHORIZED" : "HTTP_ERROR",
          message,
          details: null,
        },
      });
    }
    const shaped = error as { statusCode?: number; code?: string; message?: string };
    if (shaped.statusCode && shaped.code) {
      return reply.code(shaped.statusCode).send({
        error: { code: shaped.code, message: shaped.message ?? "请求失败", details: null },
      });
    }
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误", details: null },
    });
  }
}

export interface AppOptions {
  repository: Repository;
  clock?: () => Date;
  logger?: boolean;
  authSecret: string;
  wechatGateway?: WeChatSessionGateway;
  fieldEncryptionKey?: string;
}

function createRootModule(options: AppOptions) {
  @Module({
    imports: [
      CoreModule.register({
        repository: options.repository,
        clock: options.clock ?? (() => new Date()),
        fieldEncryptor: new FieldEncryptor(options.fieldEncryptionKey ?? options.authSecret),
      }),
      AuthModule.register(options.authSecret, options.wechatGateway),
      EventModule,
      RoadbookModule,
      RegistrationModule,
    ],
    controllers: [HealthController],
  })
  class RootModule {}

  return RootModule;
}

export async function buildApp(options: AppOptions): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    createRootModule(options),
    new FastifyAdapter({ bodyLimit: 256 * 1024 }),
    { logger: options.logger ? ["error", "warn", "log"] : false, abortOnError: false },
  );
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

import { DynamicModule, Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { JwtAuthGuard, OptionalJwtAuthGuard } from "./auth.guards.js";
import { AuthIssuer } from "./auth.issuer.js";
import { AuthService, WECHAT_SESSION_GATEWAY } from "./auth.service.js";
import { AuthVerifier } from "./auth.verifier.js";
import {
  DisabledWeChatSessionGateway,
  type WeChatSessionGateway,
} from "./wechat-session.gateway.js";

@Global()
@Module({})
export class AuthModule {
  static register(secret: string, gateway?: WeChatSessionGateway): DynamicModule {
    return {
      global: true,
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AuthVerifier, useFactory: () => new AuthVerifier(secret) },
        { provide: AuthIssuer, useFactory: () => new AuthIssuer(secret) },
        { provide: WECHAT_SESSION_GATEWAY, useValue: gateway ?? new DisabledWeChatSessionGateway() },
        AuthService,
        JwtAuthGuard,
        OptionalJwtAuthGuard,
      ],
      exports: [AuthVerifier, JwtAuthGuard, OptionalJwtAuthGuard, AuthIssuer],
    };
  }
}

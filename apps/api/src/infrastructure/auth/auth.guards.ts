import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthVerifier } from "./auth.verifier.js";
import type { AuthenticatedRequest, OptionallyAuthenticatedRequest } from "./auth.types.js";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AuthVerifier) private readonly verifier: AuthVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.verifier.verify(request.headers.authorization);
    return true;
  }
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(@Inject(AuthVerifier) private readonly verifier: AuthVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OptionallyAuthenticatedRequest>();
    const authorization = (request as FastifyRequest).headers.authorization;
    if (authorization) request.user = await this.verifier.verify(authorization);
    return true;
  }
}

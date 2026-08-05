import type { FastifyRequest } from "fastify";

export interface AuthenticatedUser {
  id: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthenticatedUser;
}

export interface OptionallyAuthenticatedRequest extends FastifyRequest {
  user?: AuthenticatedUser;
}

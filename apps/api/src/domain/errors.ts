export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (resource: string) =>
  new DomainError("NOT_FOUND", `${resource}不存在`, 404);

export const conflict = (code: string, message: string) =>
  new DomainError(code, message, 409);

export const forbidden = (message: string) =>
  new DomainError("FORBIDDEN", message, 403);

export const invalidState = (message: string) =>
  new DomainError("INVALID_STATE", message, 409);

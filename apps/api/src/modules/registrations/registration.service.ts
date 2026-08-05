import type { Repository } from "../../domain/repository.js";
import type { RegisterInput } from "./registration.schemas.js";
import type { FieldEncryptor } from "../../infrastructure/field-encryptor.js";

export class RegistrationService {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date,
    private readonly encryptor: FieldEncryptor,
  ) {}

  register(eventId: string, userId: string, idempotencyKey: string, input: RegisterInput) {
    return this.repository.registerAtomically({
      eventId,
      userId,
      idempotencyKey,
      abilityConfirmed: input.abilityConfirmed,
      equipmentConfirmed: input.equipmentConfirmed,
      waiverVersion: input.waiverVersion,
      phoneEncrypted: this.encryptor.encrypt(input.phone),
      emergencyContactEncrypted: this.encryptor.encrypt(input.emergencyContact),
      bikeType: input.bikeType,
      now: this.clock(),
    });
  }

  cancel(eventId: string, userId: string) {
    return this.repository.cancelRegistrationAtomically(eventId, userId, this.clock());
  }

  getStatus(eventId: string, userId: string) {
    return this.repository.getRegistration(eventId, userId);
  }

  listMine(userId: string) {
    return this.repository.listRegistrationsByUser(userId);
  }
}

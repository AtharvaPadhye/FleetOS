export class UnknownVehicleError extends Error {
  constructor(public readonly vehicleRef: string) {
    super(`Unknown vehicle: ${vehicleRef}`);
    this.name = "UnknownVehicleError";
  }
}

export class CommandsDisabledError extends Error {
  constructor() {
    super("Vehicle commands are disabled for this organization (enabled in Phase 7 by an owner).");
    this.name = "CommandsDisabledError";
  }
}

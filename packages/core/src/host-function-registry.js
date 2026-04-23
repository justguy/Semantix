import { NotFoundError, ValidationError } from "./contracts.js";

function assertRegistrationObject(registration) {
  if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
    throw new ValidationError("Host function registration must be an object.");
  }
}

function normalizeTargetSymbol(value, aliasValue = undefined) {
  const targetSymbol = typeof value === "string" ? value.trim() : "";
  const aliasedTargetSymbol = typeof aliasValue === "string" ? aliasValue.trim() : "";

  if (targetSymbol && aliasedTargetSymbol && targetSymbol !== aliasedTargetSymbol) {
    throw new ValidationError(
      "Host function registration targetSymbol and target_symbol must match.",
      {
        targetSymbol,
        target_symbol: aliasedTargetSymbol,
      },
    );
  }

  const normalizedTargetSymbol = targetSymbol || aliasedTargetSymbol;
  if (!normalizedTargetSymbol) {
    throw new ValidationError("Host function target_symbol must be a non-empty string.");
  }

  return normalizedTargetSymbol;
}

function assertFunction(value, fieldName) {
  if (typeof value !== "function") {
    throw new ValidationError(`Host function registration must define ${fieldName}().`, {
      field: fieldName,
    });
  }
}

function normalizeRegistration(registration) {
  assertRegistrationObject(registration);

  const targetSymbol = normalizeTargetSymbol(
    registration.targetSymbol,
    registration.target_symbol,
  );
  assertFunction(registration.invoke, "invoke");

  if (registration.preview !== undefined) {
    assertFunction(registration.preview, "preview");
  }

  return Object.freeze({
    targetSymbol,
    target_symbol: targetSymbol,
    invoke: registration.invoke,
    preview: registration.preview,
  });
}

export class HostFunctionRegistry {
  constructor(registrations = []) {
    this.registrations = new Map();

    if (registrations == null) {
      registrations = [];
    }

    if (!Array.isArray(registrations)) {
      throw new ValidationError("HostFunctionRegistry registrations must be an array.");
    }

    for (const registration of registrations) {
      this.register(registration);
    }
  }

  register(registration) {
    const normalizedRegistration = normalizeRegistration(registration);

    if (this.registrations.has(normalizedRegistration.targetSymbol)) {
      throw new ValidationError(
        `Host function '${normalizedRegistration.targetSymbol}' is already registered.`,
        {
          targetSymbol: normalizedRegistration.targetSymbol,
        },
      );
    }

    this.registrations.set(normalizedRegistration.targetSymbol, normalizedRegistration);
    return normalizedRegistration;
  }

  has(targetSymbol) {
    return this.registrations.has(normalizeTargetSymbol(targetSymbol));
  }

  resolve(targetSymbol) {
    const normalizedTargetSymbol = normalizeTargetSymbol(targetSymbol);
    const registration = this.registrations.get(normalizedTargetSymbol);

    if (!registration) {
      throw new NotFoundError(`Host function '${normalizedTargetSymbol}' is not registered.`, {
        targetSymbol: normalizedTargetSymbol,
      });
    }

    return registration;
  }

  list() {
    return [...this.registrations.values()].map(({ targetSymbol, target_symbol, preview }) => ({
      targetSymbol,
      target_symbol,
      hasPreview: typeof preview === "function",
    }));
  }

  async invoke(targetSymbol, input, context) {
    return this.resolve(targetSymbol).invoke(input, context);
  }

  async preview(targetSymbol, input, context) {
    const registration = this.resolve(targetSymbol);
    if (typeof registration.preview !== "function") {
      return undefined;
    }

    return registration.preview(input, context);
  }
}

export function createHostFunctionRegistry(registrations = []) {
  return new HostFunctionRegistry(registrations);
}

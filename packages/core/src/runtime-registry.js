import { SEMANTIX_RUNTIME_ID, ValidationError } from "./contracts.js";

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new ValidationError(`Adapter is missing required function: ${name}.`, {
      adapterField: name,
    });
  }
}

function validateRuntimeAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new ValidationError("Runtime adapter must be an object.");
  }

  if (!adapter.id) {
    throw new ValidationError("Runtime adapter must define an id.");
  }

  if (!adapter.family) {
    throw new ValidationError("Runtime adapter must define a family.");
  }

  assertFunction(adapter.getCapabilities, "getCapabilities");
  assertFunction(adapter.healthCheck, "healthCheck");
  assertFunction(adapter.executeNode, "executeNode");
  assertFunction(adapter.startSession, "startSession");
  assertFunction(adapter.submitSessionTurn, "submitSessionTurn");
  assertFunction(adapter.readSession, "readSession");
  assertFunction(adapter.listSessionTurns, "listSessionTurns");
  assertFunction(adapter.interruptSession, "interruptSession");
  assertFunction(adapter.registerSession, "registerSession");
  assertFunction(adapter.pauseRun, "pauseRun");
  assertFunction(adapter.resumeRun, "resumeRun");
  assertFunction(adapter.cancelRun, "cancelRun");
  assertFunction(adapter.streamEvents, "streamEvents");
}

function validateProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new ValidationError("Provider adapter must be an object.");
  }

  if (!adapter.id) {
    throw new ValidationError("Provider adapter must define an id.");
  }

  if (!adapter.providerKind) {
    throw new ValidationError("Provider adapter must define a providerKind.");
  }

  assertFunction(adapter.getCapabilities, "getCapabilities");
  assertFunction(adapter.healthCheck, "healthCheck");
}

export class RuntimeRegistry {
  constructor() {
    this.runtimeAdapters = new Map();
    this.providerAdapters = new Map();
    this.reviewControlContract = null;
  }

  registerRuntimeAdapter(adapter) {
    validateRuntimeAdapter(adapter);
    this.runtimeAdapters.set(adapter.id, adapter);
    return adapter;
  }

  registerProviderAdapter(adapter) {
    validateProviderAdapter(adapter);
    this.providerAdapters.set(adapter.id, adapter);
    return adapter;
  }

  registerReviewControlContract(contract) {
    if (!contract || typeof contract !== "object") {
      throw new ValidationError("Review control contract must be an object.");
    }

    this.reviewControlContract = contract;
    return contract;
  }

  getRuntimeAdapter(id = SEMANTIX_RUNTIME_ID) {
    const adapter = this.runtimeAdapters.get(id);
    if (!adapter) {
      throw new ValidationError(`Runtime adapter '${id}' is not registered.`, {
        runtimeId: id,
      });
    }

    return adapter;
  }

  listRuntimeAdapters() {
    return [...this.runtimeAdapters.values()];
  }

  listProviderAdapters() {
    return [...this.providerAdapters.values()];
  }

  async getRuntimeCapabilities(id = SEMANTIX_RUNTIME_ID) {
    const adapter = this.getRuntimeAdapter(id);
    return adapter.getCapabilities();
  }

  async healthCheck() {
    const runtimes = await Promise.all(
      [...this.runtimeAdapters.values()].map(async (adapter) => ({
        id: adapter.id,
        health: await adapter.healthCheck(),
      })),
    );

    const providers = await Promise.all(
      [...this.providerAdapters.values()].map(async (adapter) => ({
        id: adapter.id,
        health: await adapter.healthCheck(),
      })),
    );

    return {
      runtimes,
      providers,
      reviewControl: this.reviewControlContract
        ? { registered: true }
        : { registered: false },
    };
  }

  selectRuntimeForNode(node) {
    return this.getRuntimeAdapter(node?.runtimeBinding?.runtimeId ?? SEMANTIX_RUNTIME_ID);
  }
}

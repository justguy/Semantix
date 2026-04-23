import { isAbsolute, normalize, resolve, sep } from "node:path";

import {
  cloneJson,
  createArtifactHash,
  createCheckpoint,
  createIntentContract,
  ValidationError,
} from "./contracts.js";

const DEFAULT_RUNTIME_ID = "codex_cli";
const DEFAULT_RUNTIME_KIND = "cli_runtime";
const DEFAULT_TARGET_SYMBOL = "semantix.host.apply_admitted_semantic";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureString(value, label, details = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} must be a non-empty string.`, details);
  }

  return value;
}

function ensureArray(value, label, details = {}) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array.`, details);
  }

  return value;
}

function normalizePathRoot(value, label, details = {}) {
  const raw = ensureString(value, label, details);
  if (!isAbsolute(raw)) {
    throw new ValidationError(`${label} must be an absolute path.`, details);
  }

  return normalize(resolve(raw));
}

function isSameOrChildPath(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function mergePatternSchema(target, pattern) {
  if (!target.pattern) {
    target.pattern = pattern;
    return;
  }

  if (target.pattern === pattern) {
    return;
  }

  const allOf = Array.isArray(target.allOf) ? target.allOf : [];
  allOf.push({ pattern: target.pattern });
  allOf.push({ pattern });
  delete target.pattern;
  target.allOf = allOf;
}

function mergeScalarKeyword(target, fragment, key, path, details) {
  if (fragment[key] == null) {
    return;
  }

  if (target[key] == null) {
    target[key] = cloneJson(fragment[key]);
    return;
  }

  if (JSON.stringify(target[key]) !== JSON.stringify(fragment[key])) {
    throw new ValidationError(`Unsatisfiable hard-constraint merge at ${path}: conflicting ${key}.`, details);
  }
}

function mergeEnums(target, fragment, path, details) {
  if (fragment.enum == null) {
    return;
  }

  const incoming = ensureArray(fragment.enum, `${path}.enum`, details);
  if (target.const != null && !incoming.includes(target.const)) {
    throw new ValidationError(`Unsatisfiable hard-constraint merge at ${path}: const outside enum.`, details);
  }

  if (target.enum == null) {
    target.enum = [...incoming];
    return;
  }

  target.enum = target.enum.filter((value) => incoming.includes(value));
  if (target.enum.length === 0) {
    throw new ValidationError(`Unsatisfiable hard-constraint merge at ${path}: empty enum intersection.`, details);
  }
}

function mergeConst(target, fragment, path, details) {
  if (fragment.const === undefined) {
    return;
  }

  if (target.enum != null && !target.enum.includes(fragment.const)) {
    throw new ValidationError(`Unsatisfiable hard-constraint merge at ${path}: const outside enum.`, details);
  }

  if (target.const !== undefined && JSON.stringify(target.const) !== JSON.stringify(fragment.const)) {
    throw new ValidationError(`Unsatisfiable hard-constraint merge at ${path}: conflicting const.`, details);
  }

  target.const = cloneJson(fragment.const);
}

function mergeSchemaInto(target, fragment, path, details) {
  if (!isObject(fragment)) {
    throw new ValidationError(`Hard-constraint schema at ${path} must be an object.`, details);
  }

  if (fragment.type != null) {
    const nextType = ensureString(fragment.type, `${path}.type`, details);
    if (target.type != null && target.type !== nextType) {
      throw new ValidationError(`Unsatisfiable hard-constraint merge at ${path}: conflicting type.`, details);
    }
    target.type = nextType;
  }

  mergeConst(target, fragment, path, details);
  mergeEnums(target, fragment, path, details);
  mergeScalarKeyword(target, fragment, "minimum", path, details);
  mergeScalarKeyword(target, fragment, "maximum", path, details);
  mergeScalarKeyword(target, fragment, "minLength", path, details);
  mergeScalarKeyword(target, fragment, "maxLength", path, details);
  mergeScalarKeyword(target, fragment, "minItems", path, details);
  mergeScalarKeyword(target, fragment, "maxItems", path, details);

  if (fragment.pattern != null) {
    mergePatternSchema(target, ensureString(fragment.pattern, `${path}.pattern`, details));
  }

  if (fragment.additionalProperties != null) {
    if (target.additionalProperties == null) {
      target.additionalProperties = fragment.additionalProperties;
    } else if (target.additionalProperties !== fragment.additionalProperties) {
      throw new ValidationError(
        `Unsatisfiable hard-constraint merge at ${path}: conflicting additionalProperties.`,
        details,
      );
    }
  }

  if (fragment.required != null) {
    const required = ensureArray(fragment.required, `${path}.required`, details).map((entry) =>
      ensureString(entry, `${path}.required[]`, details),
    );
    target.required = [...new Set([...(target.required ?? []), ...required])];
  }

  if (fragment.properties != null) {
    if (!isObject(fragment.properties)) {
      throw new ValidationError(`${path}.properties must be an object.`, details);
    }

    target.properties = target.properties ?? {};
    for (const [key, value] of Object.entries(fragment.properties)) {
      if (!isObject(value)) {
        throw new ValidationError(`${path}.properties.${key} must be a schema object.`, details);
      }
      target.properties[key] = target.properties[key] ?? {};
      mergeSchemaInto(target.properties[key], value, `${path}.properties.${key}`, details);
    }
  }

  if (fragment.items != null) {
    if (!isObject(fragment.items)) {
      throw new ValidationError(`${path}.items must be a schema object.`, details);
    }

    target.items = target.items ?? {};
    mergeSchemaInto(target.items, fragment.items, `${path}.items`, details);
  }

  if (fragment.allOf != null) {
    const allOf = ensureArray(fragment.allOf, `${path}.allOf`, details);
    for (const entry of allOf) {
      if (!isObject(entry)) {
        throw new ValidationError(`${path}.allOf[] must be a schema object.`, details);
      }
      mergeSchemaInto(target, entry, `${path}.allOf`, details);
    }
  }
}

function ensureStrictObjectSchemas(schema, path = "root", details = {}) {
  if (!isObject(schema)) {
    throw new ValidationError(`${path} must be a schema object.`, details);
  }

  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      throw new ValidationError(`${path} must declare additionalProperties: false.`, details);
    }

    if (!isObject(schema.properties)) {
      throw new ValidationError(`${path}.properties must be an object.`, details);
    }

    if (!Array.isArray(schema.required)) {
      throw new ValidationError(`${path}.required must be an array.`, details);
    }

    for (const [key, value] of Object.entries(schema.properties)) {
      if (isObject(value)) {
        ensureStrictObjectSchemas(value, `${path}.properties.${key}`, details);
      }
    }
  }

  if (schema.type === "array" && isObject(schema.items)) {
    ensureStrictObjectSchemas(schema.items, `${path}.items`, details);
  }

  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((entry, index) => ensureStrictObjectSchemas(entry, `${path}.allOf[${index}]`, details));
  }

  for (const keyword of ["anyOf", "oneOf"]) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword].forEach((entry, index) =>
        ensureStrictObjectSchemas(entry, `${path}.${keyword}[${index}]`, details),
      );
    }
  }
}

function valueMatchesSchema(value, schema, path, details) {
  try {
    validateValueAgainstSchema(value, schema, path, details);
    return true;
  } catch (error) {
    if (error?.code === "VALIDATION_ERROR") {
      return false;
    }
    throw error;
  }
}

function validateValueAgainstSchema(value, schema, path = "root", details = {}) {
  if (!isObject(schema)) {
    throw new ValidationError(`Schema at ${path} must be an object.`, details);
  }

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      validateValueAgainstSchema(value, entry, path, details);
    }
  }

  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((entry) => valueMatchesSchema(value, entry, path, details))) {
    throw new ValidationError(`${path} must satisfy at least one anyOf branch.`, details);
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((entry) => valueMatchesSchema(value, entry, path, details)).length;
    if (matches !== 1) {
      throw new ValidationError(`${path} must satisfy exactly one oneOf branch.`, details);
    }
  }

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    throw new ValidationError(`${path} must equal the declared const.`, details);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    throw new ValidationError(`${path} must match one of the declared enum values.`, details);
  }

  switch (schema.type) {
    case "object": {
      if (!isObject(value)) {
        throw new ValidationError(`${path} must be an object.`, details);
      }

      const properties = schema.properties ?? {};
      const required = schema.required ?? [];
      for (const key of required) {
        if (!(key in value)) {
          throw new ValidationError(`${path}.${key} is required.`, details);
        }
      }

      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            throw new ValidationError(`${path}.${key} is not allowed.`, details);
          }
        }
      }

      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!(key in value)) {
          continue;
        }
        validateValueAgainstSchema(value[key], propertySchema, `${path}.${key}`, details);
      }
      return;
    }

    case "array": {
      if (!Array.isArray(value)) {
        throw new ValidationError(`${path} must be an array.`, details);
      }

      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        throw new ValidationError(`${path} must have at least ${schema.minItems} item(s).`, details);
      }

      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        throw new ValidationError(`${path} must have at most ${schema.maxItems} item(s).`, details);
      }

      if (schema.items) {
        value.forEach((entry, index) =>
          validateValueAgainstSchema(entry, schema.items, `${path}[${index}]`, details),
        );
      }
      return;
    }

    case "string": {
      if (typeof value !== "string") {
        throw new ValidationError(`${path} must be a string.`, details);
      }

      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        throw new ValidationError(`${path} must be at least ${schema.minLength} characters.`, details);
      }

      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        throw new ValidationError(`${path} must be at most ${schema.maxLength} characters.`, details);
      }

      if (schema.pattern) {
        const pattern = new RegExp(schema.pattern);
        if (!pattern.test(value)) {
          throw new ValidationError(`${path} did not match the required pattern.`, details);
        }
      }
      return;
    }

    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new ValidationError(`${path} must be a number.`, details);
      }
      return;
    }

    case "integer": {
      if (!Number.isInteger(value)) {
        throw new ValidationError(`${path} must be an integer.`, details);
      }
      return;
    }

    case "boolean": {
      if (typeof value !== "boolean") {
        throw new ValidationError(`${path} must be a boolean.`, details);
      }
      return;
    }

    case "null": {
      if (value !== null) {
        throw new ValidationError(`${path} must be null.`, details);
      }
      return;
    }

    default:
      throw new ValidationError(`${path} uses unsupported schema type "${schema.type}".`, details);
  }
}

function compileHardValidationSchema({ baseSchema, hardConstraints = [], cwd, nodeId }) {
  const details = { nodeId };
  if (!isObject(baseSchema)) {
    throw new ValidationError("semantic_generation nodes require a base object schema.", details);
  }

  const schema = cloneJson(baseSchema);
  const pathPolicies = [];

  for (const constraint of hardConstraints) {
    if (!isObject(constraint)) {
      throw new ValidationError("Hard constraints must be objects.", details);
    }

    if (constraint.kind === "path_policy") {
      const field = ensureString(constraint.field, "path_policy.field", details);
      const allowedRoots = (constraint.allowed_roots ?? []).map((entry, index) =>
        normalizePathRoot(entry, `path_policy.allowed_roots[${index}]`, details),
      );
      const forbiddenRoots = (constraint.forbidden_roots ?? []).map((entry, index) =>
        normalizePathRoot(entry, `path_policy.forbidden_roots[${index}]`, details),
      );

      if (
        allowedRoots.length > 0 &&
        allowedRoots.every((root) => forbiddenRoots.some((forbidden) => isSameOrChildPath(root, forbidden)))
      ) {
        throw new ValidationError("Hard constraints are unsatisfiable: allowed path roots are fully forbidden.", {
          ...details,
          field,
        });
      }

      schema.type = schema.type ?? "object";
      schema.properties = schema.properties ?? {};
      schema.required = schema.required ?? [];
      schema.properties[field] = schema.properties[field] ?? {};
      mergeSchemaInto(schema.properties[field], { type: "string" }, `properties.${field}`, details);
      if (constraint.required) {
        schema.required = [...new Set([...schema.required, field])];
      }

      pathPolicies.push({
        field,
        cwd: cwd ?? process.cwd(),
        allowedRoots,
        forbiddenRoots,
      });
      continue;
    }

    const fragment =
      constraint.kind === "schema_fragment" ? constraint.schema : constraint;
    mergeSchemaInto(schema, fragment, `node.${nodeId}`, details);
  }

  ensureStrictObjectSchemas(schema, `node.${nodeId}.hard_validation_schema`, details);
  return {
    hardValidationSchema: schema,
    pathPolicies,
  };
}

function canonicalizeSemanticPaths(value, pathPolicies, details = {}) {
  if (!Array.isArray(pathPolicies) || pathPolicies.length === 0) {
    return value;
  }

  const nextValue = cloneJson(value);
  for (const policy of pathPolicies) {
    if (!isObject(nextValue) || !(policy.field in nextValue)) {
      continue;
    }

    const raw = ensureString(nextValue[policy.field], policy.field, details);
    if (!isAbsolute(raw)) {
      throw new ValidationError(`Semantic path '${policy.field}' must be absolute.`, details);
    }

    const canonical = normalize(resolve(policy.cwd ?? process.cwd(), raw));
    if (policy.forbiddenRoots.some((root) => isSameOrChildPath(canonical, root))) {
      throw new ValidationError(`Semantic path '${canonical}' is forbidden by hard constraints.`, details);
    }

    if (
      policy.allowedRoots.length > 0 &&
      !policy.allowedRoots.some((root) => isSameOrChildPath(canonical, root))
    ) {
      throw new ValidationError(`Semantic path '${canonical}' is outside the allowed roots.`, details);
    }

    nextValue[policy.field] = canonical;
  }

  return nextValue;
}

function createDefaultStateEffectPreview({ runId, targetSymbol }) {
  return {
    id: `effect.${runId}.planned`,
    kind: "file",
    operation: "modify",
    target: targetSymbol,
    summary: `Advisory preview for deterministic host target '${targetSymbol}'.`,
    previewRef: `preview://${runId}/deterministic/1`,
    policyState: "review_required",
    riskFlags: ["advisory_preview"],
    reversibility: {
      status: "reversible",
      mechanism: "host_defined",
    },
    enforcement: {
      owner: "policy",
      status: "review_required",
      details: "state_effect_preview is advisory only in Semantix v0.",
    },
  };
}

function createDefaultCodeChangeSchema() {
  const referenceSchema = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "name"],
    properties: {
      kind: {
        type: "string",
        enum: ["function", "class", "module", "file", "parameter", "dependency", "symbol"],
      },
      name: {
        type: "string",
        minLength: 1,
      },
      path: {
        type: "string",
      },
      source: {
        type: "string",
        enum: ["grounded", "transformed", "invented"],
      },
      required: {
        type: "boolean",
      },
      supporting_context: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
  };
  const parameterSchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "source"],
    properties: {
      name: {
        type: "string",
        minLength: 1,
      },
      source: {
        type: "string",
        enum: ["grounded", "transformed", "invented"],
      },
      evidence: {
        type: "string",
      },
    },
  };
  const supportingContextSchema = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "value"],
    properties: {
      kind: {
        type: "string",
        enum: ["file", "symbol", "module", "note"],
      },
      value: {
        type: "string",
        minLength: 1,
      },
      path: {
        type: "string",
      },
    },
  };
  const changeSchema = {
    type: "object",
    additionalProperties: false,
    required: ["operation", "workspace_path"],
    properties: {
      operation: {
        type: "string",
        enum: ["modify_file", "create_file", "delete_file", "rename_file"],
      },
      workspace_path: {
        type: "string",
      },
      new_workspace_path: {
        type: "string",
      },
      summary: {
        type: "string",
        minLength: 1,
      },
      diff_preview: {
        type: "string",
        minLength: 1,
      },
      content: {
        type: "string",
      },
      precondition_sha256: {
        type: "string",
        pattern: "^[a-fA-F0-9]{64}$",
      },
    },
  };
  const properties = {
    summary: {
      type: "string",
      minLength: 1,
    },
    workspace_path: {
      type: "string",
    },
    diff_preview: {
      type: "string",
      minLength: 1,
    },
    changes: {
      type: "array",
      minItems: 1,
      items: changeSchema,
    },
    references: {
      type: "array",
      minItems: 1,
      items: referenceSchema,
    },
    parameters: {
      type: "array",
      items: parameterSchema,
    },
    supporting_context: {
      type: "array",
      items: supportingContextSchema,
    },
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "references", "parameters", "supporting_context"],
    properties,
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: [
          "workspace_path",
          "summary",
          "diff_preview",
          "references",
          "parameters",
          "supporting_context",
        ],
        properties,
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["summary", "changes", "references", "parameters", "supporting_context"],
        properties,
      },
    ],
  };
}

function createDefaultBlueprint({ runId, intent, cwd }) {
  return {
    intent_contract: {
      primary_directive: intent.primaryDirective,
      strict_boundaries: [...(intent.strictBoundaries ?? [])],
      success_state: intent.successState,
    },
    semantic_frames: [
      {
        frame_id: "frame.semantic.generate",
        node_id: "node.semantic.generate",
        prompt: intent.primaryDirective,
        context: {
          workflow: "code_change_execution",
          workspace_root: cwd ?? process.cwd(),
          preferred_demo: "email_verification",
          success_state: intent.successState,
          strict_boundaries: [...(intent.strictBoundaries ?? [])],
          review_expectations: [
            "Return either one legacy repo-scoped code change proposal or a CodeChangeSet with changes[].",
            "Prefer CodeChangeSet for multi-file work.",
            "Provide diff_preview for modify_file changes before execution.",
            "Provide content for create_file changes before execution.",
            "List referenced repo symbols explicitly.",
            "Mark invented parameters with source='invented'.",
            "Provide supporting_context entries for claimed dependencies.",
          ],
        },
        hard_constraints: [
          {
            kind: "path_policy",
            field: "workspace_path",
            required: false,
            allowed_roots: [cwd ?? process.cwd()],
            forbidden_roots: ["/root"],
          },
        ],
      },
    ],
    execution_graph: {
      nodes: [
        {
          node_id: "node.semantic.generate",
          kind: "semantic_generation",
          title: "Compile Semantic Proposal",
          depends_on: [],
          frame_id: "frame.semantic.generate",
          base_validation_schema: createDefaultCodeChangeSchema(),
        },
        {
          node_id: "node.approval.execute",
          kind: "approval_gate",
          title: "Approve Deterministic Execution",
          depends_on: ["node.semantic.generate"],
          target_node_id: "node.execute.host",
          reason: "Fresh approval is required before deterministic execution.",
        },
        {
          node_id: "node.execute.host",
          kind: "deterministic_execution",
          title: "Execute Admitted Semantic Output",
          depends_on: ["node.approval.execute"],
          input_node_id: "node.semantic.generate",
          target_symbol: DEFAULT_TARGET_SYMBOL,
          state_effect_preview: createDefaultStateEffectPreview({
            runId,
            targetSymbol: DEFAULT_TARGET_SYMBOL,
          }),
        },
      ],
    },
  };
}

function buildCanonicalArtifactDocument({ artifactMetadata, intentContract, semanticFrames, executionGraph }) {
  return {
    artifact_metadata: {
      artifact_id: artifactMetadata.artifact_id,
      run_id: artifactMetadata.run_id,
      plan_version: artifactMetadata.plan_version,
      graph_version: artifactMetadata.graph_version,
      generated_at: artifactMetadata.generated_at,
      freshness_state: artifactMetadata.freshness_state,
      runtime_backend: artifactMetadata.runtime_backend,
    },
    intent_contract: cloneJson(intentContract),
    semantic_frames: cloneJson(semanticFrames),
    execution_graph: cloneJson(executionGraph),
  };
}

export function validateArtifactDocument({ artifact, cwd = process.cwd() }) {
  if (!isObject(artifact)) {
    throw new ValidationError("Artifact must be an object.");
  }

  if (!isObject(artifact.artifact_metadata)) {
    throw new ValidationError("Artifact must include artifact_metadata.");
  }

  if (!isObject(artifact.intent_contract)) {
    throw new ValidationError("Artifact must include intent_contract.");
  }

  const semanticFrames = ensureArray(artifact.semantic_frames, "semantic_frames");
  const executionGraph = artifact.execution_graph;
  if (!isObject(executionGraph)) {
    throw new ValidationError("Artifact must include execution_graph.");
  }

  const nodes = ensureArray(executionGraph.nodes, "execution_graph.nodes");
  const nodeIds = new Set();
  const frameIds = new Set();

  for (const frame of semanticFrames) {
    if (!isObject(frame)) {
      throw new ValidationError("semantic_frames entries must be objects.");
    }
    frameIds.add(ensureString(frame.frame_id, "semantic_frames[].frame_id"));
  }

  for (const node of nodes) {
    if (!isObject(node)) {
      throw new ValidationError("execution_graph.nodes entries must be objects.");
    }

    const nodeId = ensureString(node.node_id, "execution_graph.nodes[].node_id");
    if (nodeIds.has(nodeId)) {
      throw new ValidationError(`Duplicate node_id '${nodeId}' in execution_graph.`);
    }
    nodeIds.add(nodeId);

    const kind = ensureString(node.kind, `execution_graph.nodes[${nodeId}].kind`);
    if (!["semantic_generation", "deterministic_execution", "approval_gate"].includes(kind)) {
      throw new ValidationError(`Unsupported v0 node kind '${kind}'.`, { nodeId });
    }

    ensureArray(node.depends_on ?? [], `execution_graph.nodes[${nodeId}].depends_on`);

    if (kind === "semantic_generation") {
      ensureString(node.frame_id, `execution_graph.nodes[${nodeId}].frame_id`, { nodeId });
      if (!frameIds.has(node.frame_id)) {
        throw new ValidationError(`semantic_generation node '${nodeId}' references unknown frame '${node.frame_id}'.`, {
          nodeId,
        });
      }

      const { hardValidationSchema } = compileHardValidationSchema({
        baseSchema: node.base_validation_schema ?? node.hard_validation_schema,
        hardConstraints: [
          ...(artifact.intent_contract.hard_constraints ?? []),
          ...(semanticFrames.find((frame) => frame.frame_id === node.frame_id)?.hard_constraints ?? []),
          ...(node.hard_constraints ?? []),
        ],
        cwd,
        nodeId,
      });

      ensureStrictObjectSchemas(hardValidationSchema, `execution_graph.nodes[${nodeId}].hard_validation_schema`, {
        nodeId,
      });
    }

    if (kind === "deterministic_execution") {
      ensureString(node.target_symbol, `execution_graph.nodes[${nodeId}].target_symbol`, { nodeId });
      ensureString(node.input_node_id, `execution_graph.nodes[${nodeId}].input_node_id`, { nodeId });
    }

    if (kind === "approval_gate") {
      ensureString(node.target_node_id, `execution_graph.nodes[${nodeId}].target_node_id`, { nodeId });
    }
  }

  for (const node of nodes) {
    for (const dependency of node.depends_on ?? []) {
      if (!nodeIds.has(dependency)) {
        throw new ValidationError(`Node '${node.node_id}' depends on unknown node '${dependency}'.`, {
          nodeId: node.node_id,
        });
      }
    }
  }

  return artifact;
}

function buildRuntimePlan({
  runId,
  intent,
  planVersion,
  graphVersion,
  artifactHash,
  generatedAt,
  semanticFrames,
  executionGraph,
}) {
  const frameById = new Map(semanticFrames.map((frame) => [frame.frame_id, frame]));
  const runtimeNodes = executionGraph.nodes.map((node) => {
    const base = {
      id: node.node_id,
      title: node.title ?? node.node_id,
      nodeType: node.kind,
      revision: 1,
      dependsOn: [...(node.depends_on ?? [])],
      reviewStatus: node.kind === "approval_gate" ? "warning" : "ready",
      executionStatus: node.kind === "approval_gate" ? "paused" : "not_started",
      approvalRequired: node.kind !== "semantic_generation",
      inputSummary: node.prompt ?? intent.primaryDirective,
      outputSummary:
        node.kind === "approval_gate"
          ? "Awaiting approval."
          : node.kind === "deterministic_execution"
            ? "Waiting for admitted semantic output."
            : "Waiting for strict semantic admission.",
      constraints: {
        hard: [
          ...(intent.strictBoundaries ?? []),
          ...(frameById.get(node.frame_id)?.hard_constraints ?? []),
          ...(node.hard_constraints ?? []),
        ],
        soft: [],
      },
      capabilityScope:
        node.kind === "semantic_generation"
          ? {
              tools: ["codex_cli"],
              permissions: ["workspace_write"],
              runtimeIds: [DEFAULT_RUNTIME_ID],
            }
          : {
              tools: [node.target_symbol ?? "approval"],
              permissions: [],
              runtimeIds: [],
            },
      riskFlags: node.kind === "deterministic_execution" ? ["deterministic_boundary"] : [],
    };

    if (node.kind === "semantic_generation") {
      const { hardValidationSchema, pathPolicies } = compileHardValidationSchema({
        baseSchema: node.base_validation_schema ?? node.hard_validation_schema,
        hardConstraints: [
          ...(intent.strictConstraints ?? []),
          ...(frameById.get(node.frame_id)?.hard_constraints ?? []),
          ...(node.hard_constraints ?? []),
        ],
        cwd: process.cwd(),
        nodeId: node.node_id,
      });

      return {
        ...base,
        semanticFrameId: node.frame_id,
        hardValidationSchema,
        pathPolicies,
        admittedOutput: null,
        runtimeBinding: {
          runtimeId: DEFAULT_RUNTIME_ID,
          family: DEFAULT_RUNTIME_KIND,
          displayName: "Codex CLI Runtime Adapter",
        },
      };
    }

    if (node.kind === "deterministic_execution") {
      return {
        ...base,
        targetSymbol: node.target_symbol,
        inputNodeId: node.input_node_id,
        stateEffectPreview: cloneJson(node.state_effect_preview ?? createDefaultStateEffectPreview({
          runId,
          targetSymbol: node.target_symbol,
        })),
      };
    }

    return {
      ...base,
      targetNodeId: node.target_node_id,
      gateReason: node.reason ?? "Awaiting fresh approval.",
    };
  });

  const deterministicNodes = runtimeNodes.filter((node) => node.nodeType === "deterministic_execution");
  const stateEffects = deterministicNodes.map((node, index) => ({
    ...(cloneJson(node.stateEffectPreview) ??
      createDefaultStateEffectPreview({
        runId,
        targetSymbol: node.targetSymbol,
      })),
    previewRef:
      node.stateEffectPreview?.previewRef ??
      `preview://${runId}/deterministic/${index + 1}`,
  }));

  const approvalGates = runtimeNodes
    .filter((node) => node.nodeType === "approval_gate")
    .map((node) => {
      const targetNode = runtimeNodes.find((candidate) => candidate.id === node.targetNodeId);
      return {
        id: `gate.${node.id}`,
        targetNodeId: node.targetNodeId,
        required: true,
        status: "pending",
        planVersion,
        artifactHash,
        nodeRevision: targetNode?.revision ?? 1,
        reason: node.gateReason,
      };
    });

  const checkpoints = [
    createCheckpoint({
      runId,
      planVersion,
      artifactHash,
      afterNodeId: "node.semantic.generate",
      reason: "awaiting_semantic_admission",
      createdAt: generatedAt,
    }),
  ];

  return {
    id: `plan.${runId}`,
    runtimeKind: DEFAULT_RUNTIME_ID,
    planVersion,
    graphVersion,
    artifactHash,
    intent,
    nodes: runtimeNodes,
    edges: runtimeNodes.flatMap((node) =>
      node.dependsOn.map((dependency) => ({
        from: dependency,
        to: node.id,
      })),
    ),
    approvalGates,
    stateEffects,
    checkpoints,
    status: "pending_review",
  };
}

export function buildSemantixV0Artifact({
  runId,
  intent,
  blueprint,
  planVersion,
  graphVersion,
  generatedAt = Date.now(),
  cwd = process.cwd(),
}) {
  const effectiveBlueprint = cloneJson(blueprint ?? createDefaultBlueprint({ runId, intent, cwd }));
  const intentContract = {
    id: `intent.${runId}`,
    primary_directive: effectiveBlueprint.intent_contract?.primary_directive ?? intent.primaryDirective,
    strict_boundaries: [
      ...(effectiveBlueprint.intent_contract?.strict_boundaries ?? intent.strictBoundaries ?? []),
    ],
    success_state: effectiveBlueprint.intent_contract?.success_state ?? intent.successState,
    contract_version: intent.contractVersion ?? 1,
    plan_version: planVersion,
  };

  const semanticFrames = ensureArray(effectiveBlueprint.semantic_frames, "semantic_frames").map((frame) => ({
    frame_id: ensureString(frame.frame_id, "semantic_frames[].frame_id"),
    node_id: ensureString(frame.node_id, "semantic_frames[].node_id"),
    prompt: ensureString(frame.prompt, "semantic_frames[].prompt"),
    context: cloneJson(frame.context ?? {}),
    hard_constraints: cloneJson(frame.hard_constraints ?? []),
  }));

  const executionGraph = {
    runtime_backend: DEFAULT_RUNTIME_ID,
    nodes: ensureArray(effectiveBlueprint.execution_graph?.nodes, "execution_graph.nodes").map((node) => ({
      node_id: ensureString(node.node_id, "execution_graph.nodes[].node_id"),
      kind: ensureString(node.kind, `execution_graph.nodes[${node.node_id}].kind`),
      title: ensureString(node.title ?? node.node_id, `execution_graph.nodes[${node.node_id}].title`),
      depends_on: [...(node.depends_on ?? [])],
      frame_id: node.frame_id,
      base_validation_schema: cloneJson(node.base_validation_schema),
      hard_constraints: cloneJson(node.hard_constraints ?? []),
      target_node_id: node.target_node_id,
      target_symbol: node.target_symbol,
      input_node_id: node.input_node_id,
      state_effect_preview: cloneJson(node.state_effect_preview ?? null),
      reason: node.reason,
    })),
  };

  const artifactMetadata = {
    artifact_id: `artifact.${runId}.${planVersion}.${generatedAt}`,
    run_id: runId,
    plan_version: planVersion,
    graph_version: graphVersion,
    generated_at: generatedAt,
    freshness_state: "fresh",
    runtime_backend: DEFAULT_RUNTIME_ID,
  };

  validateArtifactDocument({
    artifact: {
      artifact_metadata: artifactMetadata,
      intent_contract: intentContract,
      semantic_frames: semanticFrames,
      execution_graph: executionGraph,
    },
    cwd,
  });

  const canonicalDocument = buildCanonicalArtifactDocument({
    artifactMetadata,
    intentContract,
    semanticFrames,
    executionGraph,
  });
  const artifactHash = createArtifactHash(canonicalDocument);
  const runtimeIntent = createIntentContract({
    runId,
    primaryDirective: intentContract.primary_directive,
    strictBoundaries: intentContract.strict_boundaries,
    successState: intentContract.success_state,
    status: "pending_review",
    planVersion,
    contractVersion: intentContract.contract_version,
    artifactHash,
  });
  const plan = buildRuntimePlan({
    runId,
    intent: runtimeIntent,
    planVersion,
    graphVersion,
    artifactHash,
    generatedAt,
    semanticFrames,
    executionGraph,
  });

  return {
    artifactId: artifactMetadata.artifact_id,
    runId,
    planVersion,
    graphVersion,
    artifactHash,
    generatedAt,
    freshnessState: "fresh",
    artifact_metadata: {
      ...artifactMetadata,
      artifact_hash: artifactHash,
    },
    intent: runtimeIntent,
    intent_contract: {
      ...intentContract,
      artifact_hash: artifactHash,
      status: runtimeIntent.status,
    },
    semantic_frames: semanticFrames,
    execution_graph: executionGraph,
    plan,
  };
}

export function refreshSemantixV0Artifact({
  artifact,
  executionGraph = artifact.execution_graph,
  semanticFrames = artifact.semantic_frames,
  intent = artifact.intent,
  plan = artifact.plan,
  generatedAt = Date.now(),
}) {
  const intentContract = {
    id: `intent.${artifact.runId}`,
    primary_directive: intent.primaryDirective,
    strict_boundaries: [...(intent.strictBoundaries ?? [])],
    success_state: intent.successState,
    contract_version: intent.contractVersion ?? 1,
    plan_version: plan.planVersion,
  };

  const artifactMetadata = {
    artifact_id: `artifact.${artifact.runId}.${plan.planVersion}.${generatedAt}`,
    run_id: artifact.runId,
    plan_version: plan.planVersion,
    graph_version: plan.graphVersion,
    generated_at: generatedAt,
    freshness_state: "fresh",
    runtime_backend: DEFAULT_RUNTIME_ID,
  };

  validateArtifactDocument({
    artifact: {
      artifact_metadata: artifactMetadata,
      intent_contract: intentContract,
      semantic_frames: semanticFrames,
      execution_graph: executionGraph,
    },
  });

  const artifactHash = createArtifactHash(
    buildCanonicalArtifactDocument({
      artifactMetadata,
      intentContract,
      semanticFrames,
      executionGraph,
    }),
  );

  const nextArtifact = {
    ...artifact,
    artifactId: artifactMetadata.artifact_id,
    planVersion: plan.planVersion,
    graphVersion: plan.graphVersion,
    generatedAt,
    freshnessState: "fresh",
    artifactHash,
    artifact_metadata: {
      ...artifactMetadata,
      artifact_hash: artifactHash,
    },
    intent: {
      ...intent,
      artifactHash,
      planVersion: plan.planVersion,
    },
    intent_contract: {
      ...intentContract,
      artifact_hash: artifactHash,
      status: intent.status,
    },
    semantic_frames: cloneJson(semanticFrames),
    execution_graph: cloneJson(executionGraph),
    plan: {
      ...plan,
      artifactHash,
      intent: {
        ...intent,
          artifactHash,
        planVersion: plan.planVersion,
      },
      approvalGates: plan.approvalGates.map((gate) => ({
        ...gate,
        artifactHash,
        planVersion: plan.planVersion,
      })),
      checkpoints: plan.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        artifactHash,
        planVersion: plan.planVersion,
      })),
    },
  };

  return nextArtifact;
}

export function isRuntimeNode(node) {
  return node?.nodeType === "semantic_generation" && Boolean(node.runtimeBinding?.runtimeId);
}

export function isDeterministicExecutionNode(node) {
  return node?.nodeType === "deterministic_execution";
}

export function isApprovalGateNode(node) {
  return node?.nodeType === "approval_gate";
}

export function admitSemanticOutput({
  node,
  output,
  details = {},
}) {
  if (typeof output !== "string" || !output.trim()) {
    throw new ValidationError("Semantic generation output must be raw JSON text.", details);
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new ValidationError("Semantic generation output did not parse as strict JSON.", {
      ...details,
      message: error.message,
    });
  }

  const canonicalized = canonicalizeSemanticPaths(parsed, node.pathPolicies ?? [], details);
  validateValueAgainstSchema(canonicalized, node.hardValidationSchema, "semantic_output", details);
  return canonicalized;
}

export const SEMANTIX_V0_DEFAULT_TARGET_SYMBOL = DEFAULT_TARGET_SYMBOL;

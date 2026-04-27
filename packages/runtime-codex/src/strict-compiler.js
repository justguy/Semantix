import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

import { ValidationError } from "../../core/src/contracts.js";

export const STRICT_COMPILER_PROMPT_VERSION = "semantix.semantic-admission.v0";
export const STRICT_COMPILER_OUTPUT_SCHEMA_ID = "semantix.semantic_output.v0";
const SCANNABLE_CODE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
]);
const SYMBOL_VALIDATED_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
]);
const IGNORED_SCAN_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "data",
  "dist",
  "node_modules",
  "tmp",
]);
const CODE_CHANGE_OPERATIONS = new Set([
  "modify_file",
  "create_file",
  "delete_file",
  "rename_file",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function joinPath(base, segment) {
  return `${base}${segment}`;
}

function trimSummary(value, maxLength = 180) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function getNodeHardValidationSchema(node, details) {
  const schema = node?.hard_validation_schema ?? node?.hardValidationSchema;

  if (!isObject(schema)) {
    throw new ValidationError(
      "Semantic generation nodes require a hard_validation_schema object.",
      details,
    );
  }

  assertStrictSchema(schema, "hard_validation_schema", details);
  return schema;
}

function findSemanticFrameContext(node, artifact) {
  const artifactFrames = artifact?.semantic_frames ?? artifact?.semanticFrames;
  const nodeId = node?.id;

  if (Array.isArray(artifactFrames)) {
    const match = artifactFrames.find(
      (frame) =>
        frame?.node_id === nodeId ||
        frame?.nodeId === nodeId ||
        frame?.targetNodeId === nodeId ||
        frame?.id === nodeId,
    );
    if (match !== undefined) {
      return match;
    }
  }

  if (isObject(artifactFrames)) {
    if (artifactFrames[nodeId] !== undefined) {
      return artifactFrames[nodeId];
    }
    if (isObject(artifactFrames.byNodeId) && artifactFrames.byNodeId[nodeId] !== undefined) {
      return artifactFrames.byNodeId[nodeId];
    }
  }

  return (
    node?.semantic_frame_context ??
    node?.semanticFrameContext ??
    node?.semantic_frame ??
    node?.semanticFrame ??
    null
  );
}

function schemaRequiresObjectStrictness(schema) {
  if (!isObject(schema)) {
    return false;
  }

  const schemaType = schema.type;
  if (schemaType === "object") {
    return true;
  }
  if (Array.isArray(schemaType) && schemaType.includes("object")) {
    return true;
  }

  return (
    schema.properties !== undefined ||
    schema.required !== undefined ||
    schema.additionalProperties !== undefined ||
    schema.patternProperties !== undefined ||
    schema.propertyNames !== undefined ||
    schema.minProperties !== undefined ||
    schema.maxProperties !== undefined
  );
}

function assertStrictSchema(schema, schemaPath, details, visited = new Set()) {
  if (typeof schema === "boolean") {
    throw new ValidationError("hard_validation_schema must be a JSON Schema object.", {
      ...details,
      schemaPath,
    });
  }

  if (!isObject(schema)) {
    throw new ValidationError("hard_validation_schema must be a JSON Schema object.", {
      ...details,
      schemaPath,
    });
  }

  if (visited.has(schema)) {
    return;
  }
  visited.add(schema);

  if (schemaRequiresObjectStrictness(schema) && schema.additionalProperties !== false) {
    throw new ValidationError('Object schemas must declare "additionalProperties": false.', {
      ...details,
      schemaPath,
    });
  }

  if (isObject(schema.properties)) {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      assertStrictSchema(propertySchema, `${schemaPath}.properties.${key}`, details, visited);
    }
  }

  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((entry, index) => {
      assertStrictSchema(entry, `${schemaPath}.prefixItems[${index}]`, details, visited);
    });
  }

  if (schema.items !== undefined) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((entry, index) => {
        assertStrictSchema(entry, `${schemaPath}.items[${index}]`, details, visited);
      });
    } else {
      assertStrictSchema(schema.items, `${schemaPath}.items`, details, visited);
    }
  }

  if (schema.contains !== undefined) {
    assertStrictSchema(schema.contains, `${schemaPath}.contains`, details, visited);
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword].forEach((entry, index) => {
        assertStrictSchema(entry, `${schemaPath}.${keyword}[${index}]`, details, visited);
      });
    }
  }

  for (const keyword of ["not", "if", "then", "else"]) {
    if (schema[keyword] !== undefined) {
      assertStrictSchema(schema[keyword], `${schemaPath}.${keyword}`, details, visited);
    }
  }

  for (const keyword of ["$defs", "definitions", "patternProperties"]) {
    if (isObject(schema[keyword])) {
      for (const [key, child] of Object.entries(schema[keyword])) {
        assertStrictSchema(child, `${schemaPath}.${keyword}.${key}`, details, visited);
      }
    }
  }

  if (isObject(schema.propertyNames)) {
    assertStrictSchema(schema.propertyNames, `${schemaPath}.propertyNames`, details, visited);
  }
}

function matchesType(value, expectedType) {
  switch (expectedType) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isObject(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

function validateType(value, schema, instancePath, details) {
  if (schema.type === undefined) {
    return;
  }

  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!allowedTypes.some((type) => matchesType(value, type))) {
    throw new ValidationError(`Output at ${instancePath} must match type ${allowedTypes.join("|")}.`, {
      ...details,
      instancePath,
    });
  }
}

function validateEnumAndConst(value, schema, instancePath, details) {
  if (schema.const !== undefined && value !== schema.const) {
    throw new ValidationError(`Output at ${instancePath} must equal the schema const value.`, {
      ...details,
      instancePath,
    });
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => entry === value)) {
    throw new ValidationError(`Output at ${instancePath} must match one of the schema enum values.`, {
      ...details,
      instancePath,
    });
  }
}

function validateStringConstraints(value, schema, instancePath, details) {
  if (typeof value !== "string") {
    return;
  }

  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    throw new ValidationError(`Output at ${instancePath} is shorter than minLength ${schema.minLength}.`, {
      ...details,
      instancePath,
    });
  }

  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    throw new ValidationError(`Output at ${instancePath} exceeds maxLength ${schema.maxLength}.`, {
      ...details,
      instancePath,
    });
  }

  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, schema.patternFlags ?? "").test(value)) {
    throw new ValidationError(`Output at ${instancePath} does not match the required pattern.`, {
      ...details,
      instancePath,
      pattern: schema.pattern,
    });
  }
}

function validateNumberConstraints(value, schema, instancePath, details) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  if (typeof schema.minimum === "number" && value < schema.minimum) {
    throw new ValidationError(`Output at ${instancePath} is below minimum ${schema.minimum}.`, {
      ...details,
      instancePath,
    });
  }

  if (typeof schema.maximum === "number" && value > schema.maximum) {
    throw new ValidationError(`Output at ${instancePath} exceeds maximum ${schema.maximum}.`, {
      ...details,
      instancePath,
    });
  }

  if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
    throw new ValidationError(
      `Output at ${instancePath} must be greater than ${schema.exclusiveMinimum}.`,
      {
        ...details,
        instancePath,
      },
    );
  }

  if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
    throw new ValidationError(`Output at ${instancePath} must be less than ${schema.exclusiveMaximum}.`, {
      ...details,
      instancePath,
    });
  }

  if (typeof schema.multipleOf === "number" && value % schema.multipleOf !== 0) {
    throw new ValidationError(`Output at ${instancePath} must be a multiple of ${schema.multipleOf}.`, {
      ...details,
      instancePath,
    });
  }
}

function validateArrayValue(value, schema, instancePath, details) {
  if (!Array.isArray(value)) {
    return;
  }

  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    throw new ValidationError(`Output at ${instancePath} has fewer than ${schema.minItems} items.`, {
      ...details,
      instancePath,
    });
  }

  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    throw new ValidationError(`Output at ${instancePath} has more than ${schema.maxItems} items.`, {
      ...details,
      instancePath,
    });
  }

  if (schema.uniqueItems) {
    const seen = new Set();
    for (const entry of value) {
      const key = JSON.stringify(entry);
      if (seen.has(key)) {
        throw new ValidationError(`Output at ${instancePath} must contain unique array items.`, {
          ...details,
          instancePath,
        });
      }
      seen.add(key);
    }
  }

  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((entrySchema, index) => {
      if (index < value.length) {
        validateAgainstSchema(value[index], entrySchema, `${instancePath}[${index}]`, details);
      }
    });

    if (schema.items === false && value.length > schema.prefixItems.length) {
      throw new ValidationError(
        `Output at ${instancePath} includes items beyond the allowed prefixItems.`,
        {
          ...details,
          instancePath,
        },
      );
    }
  }

  if (schema.items !== undefined && schema.items !== false) {
    const startIndex = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    for (let index = startIndex; index < value.length; index += 1) {
      validateAgainstSchema(value[index], schema.items, `${instancePath}[${index}]`, details);
    }
  }

  if (schema.contains !== undefined) {
    const matches = value.some((entry, index) => {
      try {
        validateAgainstSchema(entry, schema.contains, `${instancePath}[${index}]`, details);
        return true;
      } catch {
        return false;
      }
    });

    if (!matches) {
      throw new ValidationError(`Output at ${instancePath} did not satisfy the schema contains clause.`, {
        ...details,
        instancePath,
      });
    }
  }
}

function validateObjectValue(value, schema, instancePath, details) {
  if (!isObject(value)) {
    return;
  }

  const keys = Object.keys(value);

  if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
    throw new ValidationError(
      `Output at ${instancePath} has fewer than ${schema.minProperties} properties.`,
      {
        ...details,
        instancePath,
      },
    );
  }

  if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) {
    throw new ValidationError(`Output at ${instancePath} has more than ${schema.maxProperties} properties.`, {
      ...details,
      instancePath,
    });
  }

  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new ValidationError(`Output at ${instancePath} is missing required property "${key}".`, {
        ...details,
        instancePath,
      });
    }
  }

  for (const key of keys) {
    if (isObject(schema.propertyNames)) {
      validateAgainstSchema(key, schema.propertyNames, joinPath(instancePath, `.${key}#name`), details);
    }

    if (Object.hasOwn(properties, key)) {
      validateAgainstSchema(value[key], properties[key], joinPath(instancePath, `.${key}`), details);
      continue;
    }

    const patternMatches = isObject(schema.patternProperties)
      ? Object.entries(schema.patternProperties).filter(([pattern]) => new RegExp(pattern).test(key))
      : [];

    if (patternMatches.length) {
      for (const [, childSchema] of patternMatches) {
        validateAgainstSchema(value[key], childSchema, joinPath(instancePath, `.${key}`), details);
      }
      continue;
    }

    if (schema.additionalProperties === false) {
      throw new ValidationError(`Output at ${instancePath} contains unexpected property "${key}".`, {
        ...details,
        instancePath,
      });
    }

    if (isObject(schema.additionalProperties)) {
      validateAgainstSchema(value[key], schema.additionalProperties, joinPath(instancePath, `.${key}`), details);
    }
  }
}

function validateCompoundKeywords(value, schema, instancePath, details) {
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((entry) => validateAgainstSchema(value, entry, instancePath, details));
  }

  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((entry) => schemaMatches(value, entry, instancePath, details))) {
    throw new ValidationError(`Output at ${instancePath} must satisfy at least one anyOf branch.`, {
      ...details,
      instancePath,
    });
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((entry) => schemaMatches(value, entry, instancePath, details)).length;
    if (matches !== 1) {
      throw new ValidationError(`Output at ${instancePath} must satisfy exactly one oneOf branch.`, {
        ...details,
        instancePath,
      });
    }
  }

  if (schema.not !== undefined && schemaMatches(value, schema.not, instancePath, details)) {
    throw new ValidationError(`Output at ${instancePath} matched a forbidden schema branch.`, {
      ...details,
      instancePath,
    });
  }

  if (schema.if !== undefined && schemaMatches(value, schema.if, instancePath, details)) {
    if (schema.then !== undefined) {
      validateAgainstSchema(value, schema.then, instancePath, details);
    }
  } else if (schema.else !== undefined) {
    validateAgainstSchema(value, schema.else, instancePath, details);
  }
}

function schemaMatches(value, schema, instancePath, details) {
  try {
    validateAgainstSchema(value, schema, instancePath, details);
    return true;
  } catch {
    return false;
  }
}

function validateAgainstSchema(value, schema, instancePath, details) {
  if (schema === true) {
    return;
  }

  if (schema === false) {
    throw new ValidationError(`Output at ${instancePath} is rejected by the schema.`, {
      ...details,
      instancePath,
    });
  }

  if (!isObject(schema)) {
    throw new ValidationError("hard_validation_schema must contain only schema objects.", {
      ...details,
      instancePath,
    });
  }

  validateCompoundKeywords(value, schema, instancePath, details);
  validateEnumAndConst(value, schema, instancePath, details);
  validateType(value, schema, instancePath, details);
  validateStringConstraints(value, schema, instancePath, details);
  validateNumberConstraints(value, schema, instancePath, details);
  validateArrayValue(value, schema, instancePath, details);
  validateObjectValue(value, schema, instancePath, details);
}

function parseStrictJsonStdout(stdout, details) {
  const trimmedStdout = String(stdout ?? "").trim();

  if (!trimmedStdout) {
    throw new ValidationError("Semantic admission requires stdout to contain raw JSON only.", details);
  }

  try {
    return JSON.parse(trimmedStdout);
  } catch (error) {
    throw new ValidationError(
      "Semantic admission requires the entire model stdout to be a single valid JSON document with no extra text.",
      {
        ...details,
        parseError: error.message,
      },
    );
  }
}

function buildSemanticOutputSummary(output, node) {
  if (typeof output === "string") {
    return trimSummary(output);
  }

  if (Array.isArray(output)) {
    return `Admitted semantic output array with ${output.length} item(s) for ${node.id}.`;
  }

  if (output === null) {
    return `Admitted null semantic output for ${node.id}.`;
  }

  if (typeof output === "number" || typeof output === "boolean") {
    return `Admitted semantic output ${String(output)} for ${node.id}.`;
  }

  if (isObject(output)) {
    for (const key of ["summary", "outputSummary", "title", "name", "label", "result"]) {
      const candidate = output[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return trimSummary(candidate);
      }
    }

    const keys = Object.keys(output);
    if (!keys.length) {
      return `Admitted empty semantic object for ${node.id}.`;
    }

    return `Admitted semantic output object with keys: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", ..." : ""}.`;
  }

  return `Admitted semantic output for ${node.id}.`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];
}

function normalizeReviewMetadataList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasOwnProperty(value, propertyName) {
  return Object.prototype.hasOwnProperty.call(Object(value), propertyName);
}

function resolveWorkspaceRoot(semanticFrameContext) {
  const candidate =
    semanticFrameContext?.context?.workspace_root ??
    semanticFrameContext?.workspace_root ??
    semanticFrameContext?.context?.allowed_workspace_root ??
    semanticFrameContext?.allowed_workspace_root;

  if (typeof candidate !== "string" || !candidate.trim()) {
    return normalize(resolve(process.cwd()));
  }

  return normalize(resolve(candidate));
}

function isCodeChangeProposal(output) {
  return (
    isObject(output) &&
    (typeof output.diff_preview === "string" ||
      Array.isArray(output.references) ||
      hasOwnProperty(output, "changes"))
  );
}

function getRawWorkspaceRoot(semanticFrameContext) {
  return (
    semanticFrameContext?.context?.workspace_root ??
    semanticFrameContext?.workspace_root ??
    semanticFrameContext?.context?.allowed_workspace_root ??
    semanticFrameContext?.allowed_workspace_root ??
    ""
  );
}

function getSemanticPromptText(semanticFrameContext) {
  return [
    semanticFrameContext?.prompt,
    semanticFrameContext?.context?.primary_directive,
    semanticFrameContext?.context?.primaryDirective,
    semanticFrameContext?.context?.prompt,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n");
}

function parseJsonStringLiteralAt(text, quoteIndex) {
  if (text[quoteIndex] !== "\"") {
    return null;
  }

  let escaped = false;
  for (let index = quoteIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      const literal = text.slice(quoteIndex, index + 1);
      try {
        const parsed = JSON.parse(literal);
        return typeof parsed === "string" ? parsed : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function extractExactContentContracts(semanticFrameContext) {
  const prompt = getSemanticPromptText(semanticFrameContext);
  if (!prompt) {
    return [];
  }

  const contracts = [];
  const markerPattern = /(?:this\s+exact\s+content|exact(?:ly)?(?:\s+this)?\s+content)\s*:/gi;
  let match;
  while ((match = markerPattern.exec(prompt)) !== null) {
    const quoteIndex = prompt.indexOf("\"", markerPattern.lastIndex);
    if (quoteIndex === -1) {
      continue;
    }

    const content = parseJsonStringLiteralAt(prompt, quoteIndex);
    if (content !== null) {
      contracts.push({
        content,
        sha256: sha256Text(content),
      });
    }
  }

  return dedupeReviewItems(contracts, (contract) => contract.sha256);
}

function diffPreviewDeclaresNoRepositoryChanges(diffPreview) {
  if (typeof diffPreview !== "string") {
    return false;
  }
  return /no\s+(repository|repo)?\s*file\s+modifications|no\s+(repository|repo)\s+changes|no\s+file\s+modifications/i.test(diffPreview);
}

function workspacePathMatchesRoot(workspaceRoot, semanticFrameContext, workspacePath) {
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    return true;
  }

  const trimmed = workspacePath.trim();
  const rawWorkspaceRoot = getRawWorkspaceRoot(semanticFrameContext);
  if (trimmed === "." || trimmed === rawWorkspaceRoot || trimmed === workspaceRoot) {
    return true;
  }

  const resolved = resolveProposalPath(workspaceRoot, trimmed);
  return resolved === workspaceRoot;
}

function isReviewOnlySemanticOutput(admittedOutput, semanticFrameContext, workspaceRoot) {
  return (
    isObject(admittedOutput) &&
    !hasOwnProperty(admittedOutput, "changes") &&
    diffPreviewDeclaresNoRepositoryChanges(admittedOutput.diff_preview) &&
    workspacePathMatchesRoot(workspaceRoot, semanticFrameContext, admittedOutput.workspace_path)
  );
}

function walkWorkspaceFiles(rootDir, results = []) {
  let entries = [];
  try {
    entries = readdirSync(rootDir, {
      withFileTypes: true,
    });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") {
      if (!entry.isFile()) {
        continue;
      }
    }

    const absolutePath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_SCAN_DIRS.has(entry.name)) {
        continue;
      }
      walkWorkspaceFiles(absolutePath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!SCANNABLE_CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      continue;
    }

    results.push(absolutePath);
  }

  return results;
}

function toWorkspaceRelativePath(workspaceRoot, targetPath) {
  const nextRelative = relative(workspaceRoot, targetPath);
  return nextRelative.startsWith(`..${sep}`) || nextRelative === ".." ? targetPath : nextRelative;
}

function resolveProposalPath(workspaceRoot, targetPath) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    return null;
  }

  const candidate = targetPath.trim();
  return normalize(resolve(workspaceRoot, candidate));
}

function isPathInsideWorkspace(workspaceRoot, targetPath) {
  return targetPath === workspaceRoot || targetPath.startsWith(`${workspaceRoot}${sep}`);
}

function readWorkspaceFile(absolutePath) {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return "";
  }
}

function fileExists(absolutePath) {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function supportingContextMatches(supportingContext, symbolName) {
  const normalized = String(symbolName || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return supportingContext.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    return [entry.value, entry.path, entry.symbol, entry.name]
      .filter((value) => typeof value === "string")
      .some((value) => value.toLowerCase().includes(normalized));
  });
}

function referenceSupportingContextMatches(reference, symbolName) {
  const normalized = String(symbolName || "").trim().toLowerCase();
  if (!normalized || !Array.isArray(reference?.supporting_context)) {
    return false;
  }

  return reference.supporting_context
    .filter((entry) => typeof entry === "string")
    .some((entry) => entry.toLowerCase().includes(normalized));
}

function hasReferenceSupport({ supportingContext, reference, name }) {
  return (
    supportingContextMatches(supportingContext, name) ||
    supportingContextMatches(supportingContext, reference?.path) ||
    referenceSupportingContextMatches(reference, name) ||
    referenceSupportingContextMatches(reference, reference?.path)
  );
}

function isSymbolValidatedWorkspacePath(targetPath) {
  return typeof targetPath === "string" && SYMBOL_VALIDATED_EXTENSIONS.has(extname(targetPath).toLowerCase());
}

function buildProposalExecutableText(admittedOutput, changes) {
  const chunks = [];
  const legacyIsCodeLike =
    !hasOwnProperty(admittedOutput, "workspace_path") ||
    isSymbolValidatedWorkspacePath(admittedOutput?.workspace_path);
  if (legacyIsCodeLike && typeof admittedOutput?.diff_preview === "string") {
    chunks.push(admittedOutput.diff_preview);
  }
  if (legacyIsCodeLike && typeof admittedOutput?.content === "string") {
    chunks.push(admittedOutput.content);
  }
  for (const change of changes) {
    if (!isSymbolValidatedWorkspacePath(change?.workspace_path)) {
      continue;
    }
    if (typeof change?.diff_preview === "string") {
      chunks.push(change.diff_preview);
    }
    if (typeof change?.content === "string") {
      chunks.push(change.content);
    }
  }
  return chunks.join("\n");
}

function proposalExecutableTextUsesName(executableText, name) {
  if (typeof name !== "string" || !name.trim() || !executableText) {
    return false;
  }
  return new RegExp(`\\b${escapeRegExp(name.trim())}\\b`).test(executableText);
}

function isSemantixMetadataReference(reference) {
  const name = typeof reference?.name === "string" ? reference.name.trim() : "";
  const metadataNames = new Set([
    "artifact_hash",
    "artifact_path",
    "checkpoint_id",
    "graph_version",
    "node_revision",
    "plan_version",
    "requested_joke_topic",
    "review_before_execution",
    "run_id",
    "state_effect",
    "workspace_root",
  ]);

  return (
    metadataNames.has(name) ||
    name.startsWith("effect.") ||
    name.startsWith("checkpoint.") ||
    name.startsWith("artifact.")
  );
}

function findSymbolEvidence(workspaceRoot, symbolName) {
  if (typeof symbolName !== "string" || !symbolName.trim()) {
    return null;
  }

  const matcher = new RegExp(`\\b${escapeRegExp(symbolName.trim())}\\b`);
  for (const absolutePath of walkWorkspaceFiles(workspaceRoot)) {
    const content = readWorkspaceFile(absolutePath);
    if (!content || !matcher.test(content)) {
      continue;
    }

    return {
      kind: "repo_symbol",
      detail: `Found '${symbolName}' in ${toWorkspaceRelativePath(workspaceRoot, absolutePath)}.`,
      path: toWorkspaceRelativePath(workspaceRoot, absolutePath),
      symbol: symbolName,
    };
  }

  return null;
}

function sha256Text(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeProposalChanges(admittedOutput) {
  if (!hasOwnProperty(admittedOutput, "changes")) {
    const hasLegacyFileChange =
      hasOwnProperty(admittedOutput, "workspace_path") ||
      hasOwnProperty(admittedOutput, "diff_preview") ||
      hasOwnProperty(admittedOutput, "content") ||
      hasOwnProperty(admittedOutput, "precondition_sha256");

    if (!hasLegacyFileChange) {
      return [];
    }

    return [
      {
        index: 0,
        operation: "modify_file",
        workspace_path: admittedOutput?.workspace_path,
        diff_preview: admittedOutput?.diff_preview,
        content: admittedOutput?.content,
        precondition_sha256: admittedOutput?.precondition_sha256,
        source: "legacy_single_file",
        original: admittedOutput,
      },
    ];
  }

  if (!Array.isArray(admittedOutput.changes)) {
    return [];
  }

  return admittedOutput.changes.map((change, index) => ({
    index,
    operation: change?.operation,
    workspace_path: change?.workspace_path,
    new_workspace_path: change?.new_workspace_path,
    diff_preview: change?.diff_preview,
    content: change?.content,
    precondition_sha256: change?.precondition_sha256,
    source: "code_change_set",
    original: change,
  }));
}

function buildChangeAffectedFiles(workspaceRoot, change) {
  const affectedFiles = [];
  const targetPath = resolveProposalPath(workspaceRoot, change.workspace_path);
  if (targetPath) {
    affectedFiles.push(toWorkspaceRelativePath(workspaceRoot, targetPath));
  }

  const newTargetPath = resolveProposalPath(workspaceRoot, change.new_workspace_path);
  if (newTargetPath) {
    affectedFiles.push(toWorkspaceRelativePath(workspaceRoot, newTargetPath));
  }

  return dedupeReviewItems(affectedFiles, (entry) => entry);
}

function getProposalDiffPreview(admittedOutput) {
  if (typeof admittedOutput?.diff_preview === "string") {
    return admittedOutput.diff_preview;
  }

  if (!Array.isArray(admittedOutput?.changes)) {
    return null;
  }

  const previews = admittedOutput.changes
    .map((change) => (typeof change?.diff_preview === "string" ? change.diff_preview : null))
    .filter(Boolean);

  return previews.length > 0 ? previews.join("\n") : null;
}

function normalizeDiffPreviewLines(diffPreview) {
  const lines = String(diffPreview ?? "").replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function isDiffMetadataLine(line) {
  return (
    !line ||
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  );
}

function isSimpleDiffLine(line) {
  return !line || line[0] === "+" || line[0] === "-" || line[0] === " " || line === "\\ No newline at end of file";
}

function validateBareHunkDiffPreviewSyntax(diffLines) {
  let sawBareHunk = false;

  for (const line of diffLines) {
    if (isDiffMetadataLine(line)) {
      continue;
    }

    if (!sawBareHunk) {
      if (line === "@@") {
        sawBareHunk = true;
        continue;
      }
      return null;
    }

    if (line.startsWith("@@ ")) {
      return null;
    }

    if (!isSimpleDiffLine(line)) {
      return {
        detail: `Unsupported bare diff_preview line '${line}'.`,
        evidence: line,
      };
    }
  }

  return sawBareHunk ? false : null;
}

function validateUnifiedDiffPreviewSyntax(diffLines) {
  let lineIndex = 0;
  let sawHunk = false;

  while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@")) {
    const line = diffLines[lineIndex];
    if (!isDiffMetadataLine(line)) {
      return {
        detail: `Unsupported diff_preview metadata before the first hunk: '${line}'.`,
        evidence: line,
      };
    }
    lineIndex += 1;
  }

  while (lineIndex < diffLines.length) {
    const header = diffLines[lineIndex];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!match) {
      return {
        detail: `Invalid unified diff hunk header '${header}'. Use numeric ranges such as '@@ -1,3 +1,4 @@'.`,
        evidence: header,
      };
    }

    sawHunk = true;
    lineIndex += 1;
    while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@")) {
      const line = diffLines[lineIndex];
      if (!isSimpleDiffLine(line)) {
        return {
          detail: `Unsupported unified diff_preview line '${line}'.`,
          evidence: line,
        };
      }
      lineIndex += 1;
    }
  }

  if (!sawHunk) {
    return {
      detail: "diff_preview did not include a unified diff hunk.",
      evidence: null,
    };
  }

  return false;
}

function validateDiffPreviewSyntax(diffPreview) {
  if (typeof diffPreview !== "string" || diffPreview.trim().length === 0) {
    return {
      detail: "diff_preview must be a non-empty simple diff or unified diff.",
      evidence: diffPreview ?? null,
    };
  }

  const diffLines = normalizeDiffPreviewLines(diffPreview);
  const bareHunkIssue = validateBareHunkDiffPreviewSyntax(diffLines);
  if (bareHunkIssue === false) {
    return null;
  }
  if (bareHunkIssue) {
    return bareHunkIssue;
  }

  const normalizedDiff = diffLines.join("\n");
  const isUnifiedDiff =
    normalizedDiff.includes("\n@@ ") ||
    normalizedDiff.startsWith("@@ ") ||
    normalizedDiff.startsWith("--- ");

  if (isUnifiedDiff) {
    return validateUnifiedDiffPreviewSyntax(diffLines) || null;
  }

  for (const line of diffLines) {
    if (!isSimpleDiffLine(line)) {
      return {
        detail: `diff_preview line must start with '+', '-', or space: '${line}'.`,
        evidence: line,
      };
    }
  }

  return null;
}

function extractBareHunkSimpleDiffLines(diffLines) {
  const simpleLines = [];
  let sawBareHunk = false;

  for (const line of diffLines) {
    if (isDiffMetadataLine(line)) {
      continue;
    }

    if (line === "@@") {
      sawBareHunk = true;
      continue;
    }

    if (line.startsWith("@@ ")) {
      return null;
    }

    if (!sawBareHunk) {
      return null;
    }

    simpleLines.push(line);
  }

  return sawBareHunk ? simpleLines : null;
}

function toDiffLineRecord(content) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }
  return lines;
}

function toDiffContentRecord(content) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }
  return {
    lines,
    hasTrailingNewline,
  };
}

function fromDiffContentRecord(lines, hasTrailingNewline) {
  if (lines.length === 0) {
    return "";
  }

  const body = lines.join("\n");
  return hasTrailingNewline ? `${body}\n` : body;
}

function validateSimpleDiffPreviewApplication(currentContent, diffLines) {
  const nextLines = toDiffLineRecord(currentContent);

  for (const line of diffLines) {
    if (!line) {
      continue;
    }

    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "+") {
      nextLines.push(value);
      continue;
    }

    if (prefix === "-") {
      const index = nextLines.indexOf(value);
      if (index === -1) {
        return {
          detail: `diff_preview removal did not match the current file: '${line}'.`,
          evidence: line,
        };
      }
      nextLines.splice(index, 1);
      continue;
    }

    if (prefix === " ") {
      if (!nextLines.includes(value)) {
        return {
          detail: `diff_preview context line did not match the current file: '${line}'.`,
          evidence: line,
        };
      }
    }
  }

  return null;
}

function buildSimpleDiffPreviewContent(currentContent, diffLines) {
  const current = toDiffContentRecord(currentContent);
  const nextLines = [...current.lines];

  for (const line of diffLines) {
    if (!line) {
      continue;
    }

    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "+") {
      nextLines.push(value);
      continue;
    }

    if (prefix === "-") {
      const index = nextLines.indexOf(value);
      if (index === -1) {
        return {
          issue: {
            detail: `diff_preview removal did not match the current file: '${line}'.`,
            evidence: line,
          },
        };
      }
      nextLines.splice(index, 1);
      continue;
    }

    if (prefix === " " && !nextLines.includes(value)) {
      return {
        issue: {
          detail: `diff_preview context line did not match the current file: '${line}'.`,
          evidence: line,
        },
      };
    }
  }

  const nextHasTrailingNewline =
    nextLines.length === 0 ? false : current.hasTrailingNewline || current.lines.length === 0;
  return {
    content: fromDiffContentRecord(nextLines, nextHasTrailingNewline),
  };
}

function validateUnifiedDiffPreviewApplication(currentContent, diffLines) {
  const currentLines = toDiffLineRecord(currentContent);
  let sourceIndex = 0;
  let lineIndex = 0;

  while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@ ")) {
    lineIndex += 1;
  }

  while (lineIndex < diffLines.length) {
    const header = diffLines[lineIndex];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!match) {
      return {
        detail: `Invalid unified diff hunk header '${header}'.`,
        evidence: header,
      };
    }

    const oldStart = Number(match[1]);
    const oldCount = match[2] == null ? 1 : Number(match[2]);
    sourceIndex = Math.max(oldStart - 1, 0);
    lineIndex += 1;

    let consumedOldLines = 0;
    while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@ ")) {
      const line = diffLines[lineIndex];
      if (line === "\\ No newline at end of file") {
        lineIndex += 1;
        continue;
      }

      const prefix = line[0];
      const value = line.slice(1);
      if (prefix === " " || prefix === "-") {
        if (currentLines[sourceIndex] !== value) {
          return {
            detail: `diff_preview did not match the current file at '${line}'.`,
            evidence: line,
          };
        }
        sourceIndex += 1;
        consumedOldLines += 1;
      }
      lineIndex += 1;
    }

    if (consumedOldLines !== oldCount) {
      return {
        detail: `diff_preview hunk count did not match ${header}.`,
        evidence: header,
      };
    }
  }

  return null;
}

function buildUnifiedDiffPreviewContent(currentContent, diffLines) {
  const current = toDiffContentRecord(currentContent);
  const output = [];
  let sourceIndex = 0;
  let lineIndex = 0;
  let hasTrailingNewline = current.hasTrailingNewline;

  while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@ ")) {
    lineIndex += 1;
  }

  while (lineIndex < diffLines.length) {
    const header = diffLines[lineIndex];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!match) {
      return {
        issue: {
          detail: `Invalid unified diff hunk header '${header}'.`,
          evidence: header,
        },
      };
    }

    const oldStart = Number(match[1]);
    const oldCount = match[2] == null ? 1 : Number(match[2]);
    const copyEnd = Math.max(oldStart - 1, 0);
    output.push(...current.lines.slice(sourceIndex, copyEnd));
    sourceIndex = copyEnd;
    lineIndex += 1;

    let consumedOldLines = 0;
    while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@ ")) {
      const line = diffLines[lineIndex];
      if (line === "\\ No newline at end of file") {
        hasTrailingNewline = false;
        lineIndex += 1;
        continue;
      }

      const prefix = line[0];
      const value = line.slice(1);
      if (prefix === " " || prefix === "-") {
        if (current.lines[sourceIndex] !== value) {
          return {
            issue: {
              detail: `diff_preview did not match the current file at '${line}'.`,
              evidence: line,
            },
          };
        }
        if (prefix === " ") {
          output.push(value);
        }
        sourceIndex += 1;
        consumedOldLines += 1;
      } else if (prefix === "+") {
        output.push(value);
      }
      lineIndex += 1;
    }

    if (consumedOldLines !== oldCount) {
      return {
        issue: {
          detail: `diff_preview hunk count did not match ${header}.`,
          evidence: header,
        },
      };
    }
  }

  output.push(...current.lines.slice(sourceIndex));
  const nextHasTrailingNewline =
    output.length === 0 ? false : hasTrailingNewline || current.lines.length === 0;
  return {
    content: fromDiffContentRecord(output, nextHasTrailingNewline),
  };
}

function validateDiffPreviewAgainstCurrentFile(currentContent, diffPreview) {
  const syntaxIssue = validateDiffPreviewSyntax(diffPreview);
  if (syntaxIssue) {
    return syntaxIssue;
  }

  const diffLines = normalizeDiffPreviewLines(diffPreview);
  const bareHunkLines = extractBareHunkSimpleDiffLines(diffLines);
  if (bareHunkLines) {
    return validateSimpleDiffPreviewApplication(currentContent, bareHunkLines);
  }

  const normalizedDiff = diffLines.join("\n");
  const isUnifiedDiff =
    normalizedDiff.includes("\n@@ ") ||
    normalizedDiff.startsWith("@@ ") ||
    normalizedDiff.startsWith("--- ");

  return isUnifiedDiff
    ? validateUnifiedDiffPreviewApplication(currentContent, diffLines)
    : validateSimpleDiffPreviewApplication(currentContent, diffLines);
}

function buildModifyFileProposedContent(currentContent, change) {
  if (typeof change?.diff_preview === "string") {
    const syntaxIssue = validateDiffPreviewSyntax(change.diff_preview);
    if (syntaxIssue) {
      return { issue: syntaxIssue };
    }

    const diffLines = normalizeDiffPreviewLines(change.diff_preview);
    const bareHunkLines = extractBareHunkSimpleDiffLines(diffLines);
    if (bareHunkLines) {
      return buildSimpleDiffPreviewContent(currentContent, bareHunkLines);
    }

    const normalizedDiff = diffLines.join("\n");
    const isUnifiedDiff =
      normalizedDiff.includes("\n@@ ") ||
      normalizedDiff.startsWith("@@ ") ||
      normalizedDiff.startsWith("--- ");

    return isUnifiedDiff
      ? buildUnifiedDiffPreviewContent(currentContent, diffLines)
      : buildSimpleDiffPreviewContent(currentContent, diffLines);
  }

  if (typeof change?.content === "string") {
    return {
      content: change.content,
    };
  }

  return {
    issue: {
      detail: "modify_file requires diff_preview or content.",
      evidence: null,
    },
  };
}

function formatChangeLabel(change) {
  return change.source === "legacy_single_file" ? "legacy proposal" : `changes[${change.index}]`;
}

function buildReviewInterventions(issueCode) {
  const map = {
    content_mismatch: [
      {
        kind: "regenerate_content",
        detail: "Regenerate the proposal so content exactly matches the user-provided exact content literal.",
      },
    ],
    invented_parameter: [
      {
        kind: "fix_assumption",
        detail: "Remove the invented parameter or ground it in repo context before approval.",
      },
    ],
    invalid_target_path: [
      {
        kind: "narrow_file_scope",
        detail: "Retarget the proposal to a file inside the allowed workspace scope.",
      },
    ],
    missing_supporting_context: [
      {
        kind: "ask_for_missing_context",
        detail: "Load the missing dependency or supporting symbol into context before continuing.",
      },
    ],
    missing_symbol: [
      {
        kind: "add_source",
        detail: "Add the missing helper to context or change the proposal to a symbol that exists.",
      },
      {
        kind: "fix_assumption",
        detail: "Replace the invented reference with a repo symbol that actually exists.",
      },
    ],
    invalid_diff_preview: [
      {
        kind: "regenerate_diff_preview",
        detail: "Regenerate the proposal with an applyable simple diff or a unified diff with numeric hunk ranges.",
      },
    ],
    stale_precondition: [
      {
        kind: "refresh_context",
        detail: "Reload the target file and regenerate the proposal against the current workspace bytes.",
      },
    ],
    unsupported_assumption: [
      {
        kind: "fix_assumption",
        detail: "Remove or replace the unsupported assumption with a deterministic precondition.",
      },
    ],
    unsupported_change_shape: [
      {
        kind: "fix_output_shape",
        detail: "Emit either the legacy single-file shape or a strict CodeChangeSet with valid changes[].",
      },
    ],
  };

  return map[issueCode] ?? [
    {
      kind: "require_approval",
      detail: "Require manual review before deterministic execution continues.",
    },
  ];
}

function createReviewIssue({
  issueCode,
  message,
  detail,
  affectedFiles = [],
  affectedSymbols = [],
  blocking = true,
  evidence = [],
}) {
  return {
    code: issueCode,
    type: issueCode,
    summary: message,
    message,
    detail,
    blocking,
    evidence,
    affectedFiles,
    affectedSymbols,
    interventions: buildReviewInterventions(issueCode),
  };
}

function dedupeReviewItems(items, keyBuilder) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export function buildDeterministicCodeChangeReview({
  admittedOutput,
  semanticFrameContext,
}) {
  const workspaceRoot = resolveWorkspaceRoot(semanticFrameContext);
  const supportingContext = Array.isArray(admittedOutput?.supporting_context)
    ? admittedOutput.supporting_context
    : [];
  const issues = [];
  const evidence = [];
  const exactContentContracts = extractExactContentContracts(semanticFrameContext);

  if (!isCodeChangeProposal(admittedOutput)) {
    return {
      workspaceRoot,
      issues,
      evidence,
      interventions: [],
      blocking: false,
      blockingReason: null,
      targetPath: admittedOutput?.workspace_path ?? null,
      diffPreview: null,
    };
  }

  if (isReviewOnlySemanticOutput(admittedOutput, semanticFrameContext, workspaceRoot)) {
    return {
      workspaceRoot,
      issues,
      evidence: [{
        kind: "semantic_output",
        detail: admittedOutput.summary ?? "Review-only semantic output.",
      }],
      interventions: [],
      blocking: false,
      blockingReason: null,
      targetPath: null,
      targetPaths: [],
      diffPreview: admittedOutput.diff_preview ?? null,
      semanticOnly: true,
    };
  }

  const changes = normalizeProposalChanges(admittedOutput);
  const affectedFiles = [];
  const targetPaths = [];

  if (hasOwnProperty(admittedOutput, "changes")) {
    if (!Array.isArray(admittedOutput.changes) || admittedOutput.changes.length === 0) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: "CodeChangeSet proposals must include a non-empty changes[] array.",
          detail: "changes must be an array with at least one file operation.",
        }),
      );
    }
  }

  for (const listName of ["references", "parameters", "supporting_context"]) {
    if (hasOwnProperty(admittedOutput, listName) && !Array.isArray(admittedOutput[listName])) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: `${listName} must be a top-level array.`,
          detail: `Received unsupported ${listName} shape.`,
        }),
      );
    }
  }

  if (hasOwnProperty(admittedOutput, "assumptions")) {
    const assumptions = Array.isArray(admittedOutput.assumptions)
      ? admittedOutput.assumptions
      : [admittedOutput.assumptions];
    for (const assumption of assumptions) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_assumption",
          message: "This proposal included an unsupported assumption.",
          detail: typeof assumption === "string" ? assumption : "Use precondition_sha256 for file freshness assumptions.",
          evidence: [
            {
              kind: "unsupported_assumption",
              detail: typeof assumption === "string" ? assumption : "assumptions is not part of the deterministic change contract.",
            },
          ],
        }),
      );
    }
  }

  for (const change of changes) {
    const label = formatChangeLabel(change);
    const changeAffectedFiles = buildChangeAffectedFiles(workspaceRoot, change);
    affectedFiles.push(...changeAffectedFiles);

    if (!isObject(change.original)) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: `${label} must be an object.`,
          detail: "Each CodeChangeSet entry must be an object.",
          affectedFiles: changeAffectedFiles,
        }),
      );
      continue;
    }

    if (change.source === "code_change_set") {
      for (const nestedField of ["references", "parameters", "supporting_context"]) {
        if (hasOwnProperty(change.original, nestedField)) {
          issues.push(
            createReviewIssue({
              issueCode: "unsupported_change_shape",
              message: `${label} used unsupported nested ${nestedField}.`,
              detail: "references, parameters, and supporting_context must remain top-level arrays.",
              affectedFiles: changeAffectedFiles,
            }),
          );
        }
      }
    }

    if (!CODE_CHANGE_OPERATIONS.has(change.operation)) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: `${label} uses unsupported operation '${change.operation ?? ""}'.`,
          detail: "operation must be one of modify_file, create_file, delete_file, rename_file.",
          affectedFiles: changeAffectedFiles,
        }),
      );
    }

    const targetPath = resolveProposalPath(workspaceRoot, change.workspace_path);
    const targetPathIsInside = targetPath && isPathInsideWorkspace(workspaceRoot, targetPath);
    if (!targetPath || !targetPathIsInside) {
      const invalidTargetDetail = targetPath
        ? `workspace_path resolved to ${targetPath}, outside the allowed workspace scope.`
        : "workspace_path is required.";
      issues.push(
        createReviewIssue({
          issueCode: "invalid_target_path",
          message: `${label} has an invalid workspace_path.`,
          detail: invalidTargetDetail,
          affectedFiles: changeAffectedFiles,
          evidence: [
            {
              kind: "target_path",
              detail: invalidTargetDetail,
              path: change.workspace_path,
            },
          ],
        }),
      );
    } else {
      targetPaths.push(targetPath);
    }

    const newTargetPath = resolveProposalPath(workspaceRoot, change.new_workspace_path);
    const newTargetPathIsInside = newTargetPath && isPathInsideWorkspace(workspaceRoot, newTargetPath);
    if (change.operation === "rename_file" && (!newTargetPath || !newTargetPathIsInside)) {
      const invalidNewTargetDetail = newTargetPath
        ? `new_workspace_path resolved to ${newTargetPath}, outside the allowed workspace scope.`
        : "new_workspace_path is required for rename_file.";
      issues.push(
        createReviewIssue({
          issueCode: "invalid_target_path",
          message: `${label} has an invalid new_workspace_path.`,
          detail: invalidNewTargetDetail,
          affectedFiles: changeAffectedFiles,
          evidence: [
            {
              kind: "target_path",
              detail: invalidNewTargetDetail,
              path: change.new_workspace_path,
            },
          ],
        }),
      );
    }

    if (change.operation !== "rename_file" && hasText(change.new_workspace_path)) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: `${label} used new_workspace_path without rename_file.`,
          detail: "new_workspace_path is only supported for rename_file operations.",
          affectedFiles: changeAffectedFiles,
        }),
      );
    }

    const hasDiffPreview = typeof change.diff_preview === "string";
    const hasContent = typeof change.content === "string";
    if (change.operation === "modify_file" && !hasDiffPreview && !hasContent) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: `${label} modify_file requires diff_preview or content.`,
          detail: "modify_file changes must include a deterministic preview or replacement content.",
          affectedFiles: changeAffectedFiles,
        }),
      );
    }
    let diffPreviewIssue = null;
    if (change.operation === "modify_file" && hasDiffPreview) {
      diffPreviewIssue = validateDiffPreviewSyntax(change.diff_preview);
      if (diffPreviewIssue) {
        issues.push(
          createReviewIssue({
            issueCode: "invalid_diff_preview",
            message: `${label} has an invalid diff_preview.`,
            detail: diffPreviewIssue.detail,
            affectedFiles: changeAffectedFiles,
            evidence: [
              {
                kind: "diff_preview",
                detail: diffPreviewIssue.detail,
                path: change.workspace_path,
                value: diffPreviewIssue.evidence,
              },
            ],
          }),
        );
      }
    }
    if (change.operation === "create_file" && !hasContent) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: `${label} create_file requires content.`,
          detail: "create_file changes must include file content.",
          affectedFiles: changeAffectedFiles,
        }),
      );
    }
    if (change.operation === "delete_file" && hasContent) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_change_shape",
          message: `${label} delete_file cannot include content.`,
          detail: "delete_file may include diff_preview, but not replacement content.",
          affectedFiles: changeAffectedFiles,
        }),
      );
    }

    if (!targetPathIsInside) {
      continue;
    }

    const sourceExists = fileExists(targetPath);
    if (change.operation === "create_file") {
      if (sourceExists) {
        if (change.precondition_sha256 === undefined) {
          issues.push(
            createReviewIssue({
              issueCode: "unsupported_assumption",
              message: `${label} would overwrite an existing file without precondition_sha256.`,
              detail: toWorkspaceRelativePath(workspaceRoot, targetPath),
              affectedFiles: changeAffectedFiles,
            }),
          );
          continue;
        }
      } else if (change.precondition_sha256 !== undefined) {
        issues.push(
          createReviewIssue({
            issueCode: "unsupported_assumption",
            message: `${label} uses precondition_sha256 for a new file path.`,
            detail: "precondition_sha256 is only supported when replacing or changing an existing source file.",
            affectedFiles: changeAffectedFiles,
          }),
        );
        continue;
      }
      if (change.precondition_sha256 === undefined) {
        continue;
      }
    } else if (!sourceExists && CODE_CHANGE_OPERATIONS.has(change.operation)) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_assumption",
          message: `${label} assumes the source file exists, but it was not found.`,
          detail: toWorkspaceRelativePath(workspaceRoot, targetPath),
          affectedFiles: changeAffectedFiles,
        }),
      );
      continue;
    }

    if (change.operation === "modify_file" && hasDiffPreview && !diffPreviewIssue) {
      const applicationIssue = validateDiffPreviewAgainstCurrentFile(
        readWorkspaceFile(targetPath),
        change.diff_preview,
      );
      if (applicationIssue) {
        issues.push(
          createReviewIssue({
            issueCode: "invalid_diff_preview",
            message: `${label} has an invalid diff_preview.`,
            detail: applicationIssue.detail,
            affectedFiles: changeAffectedFiles,
            evidence: [
              {
                kind: "diff_preview",
                detail: applicationIssue.detail,
                path: change.workspace_path,
                value: applicationIssue.evidence,
              },
            ],
          }),
        );
      }
    }

    if (change.operation === "modify_file" && exactContentContracts.length > 0) {
      const proposedContent = buildModifyFileProposedContent(readWorkspaceFile(targetPath), change);
      if (proposedContent.content !== undefined) {
        const contentHash = sha256Text(proposedContent.content);
        const matchingContract = exactContentContracts.find((contract) => contract.sha256 === contentHash);
        if (!matchingContract) {
          issues.push(
            createReviewIssue({
              issueCode: "content_mismatch",
              message: `${label} content does not match the exact content requested by the user.`,
              detail: "The user supplied an exact JSON string literal, but the proposed final file bytes differ.",
              affectedFiles: changeAffectedFiles,
              evidence: [
                {
                  kind: "content_sha256",
                  detail: "Proposed final content differed from the exact prompt literal.",
                  path: change.workspace_path,
                  expectedSha256: exactContentContracts[0].sha256,
                  actualSha256: contentHash,
                  expectedLength: exactContentContracts[0].content.length,
                  actualLength: proposedContent.content.length,
                },
              ],
            }),
          );
        }
      }
    }

    if (change.precondition_sha256 === undefined) {
      continue;
    }

    if (!isSha256Hex(change.precondition_sha256)) {
      issues.push(
        createReviewIssue({
          issueCode: "unsupported_assumption",
          message: `${label} has an unsupported precondition_sha256.`,
          detail: "precondition_sha256 must be a 64-character hex SHA-256 digest.",
          affectedFiles: changeAffectedFiles,
          evidence: [
            {
              kind: "precondition_sha256",
              detail: String(change.precondition_sha256),
              path: toWorkspaceRelativePath(workspaceRoot, targetPath),
            },
          ],
        }),
      );
      continue;
    }

    const currentHash = sha256Text(readWorkspaceFile(targetPath));
    if (currentHash.toLowerCase() !== change.precondition_sha256.toLowerCase()) {
      issues.push(
        createReviewIssue({
          issueCode: "stale_precondition",
          message: `${label} was generated against stale file bytes.`,
          detail: `Expected ${change.precondition_sha256}, found ${currentHash}.`,
          affectedFiles: changeAffectedFiles,
          evidence: [
            {
              kind: "precondition_sha256",
              detail: `Expected ${change.precondition_sha256}, found ${currentHash}.`,
              path: toWorkspaceRelativePath(workspaceRoot, targetPath),
            },
          ],
        }),
      );
    }
  }

  const reviewAffectedFiles = dedupeReviewItems(affectedFiles, (entry) => entry);
  const createdTargetPaths = new Set(
    changes
      .filter((change) => change.operation === "create_file")
      .map((change) => resolveProposalPath(workspaceRoot, change.workspace_path))
      .filter((targetPath) => targetPath && isPathInsideWorkspace(workspaceRoot, targetPath)),
  );
  const executableText = buildProposalExecutableText(admittedOutput, changes);

  const parameters = Array.isArray(admittedOutput.parameters) ? admittedOutput.parameters : [];
  for (const parameter of parameters) {
    if (
      parameter?.source === "invented" &&
      proposalExecutableTextUsesName(executableText, parameter.name)
    ) {
      issues.push(
        createReviewIssue({
          issueCode: "invented_parameter",
          message: `This parameter was invented: '${parameter.name}'.`,
          detail: parameter.evidence ?? "No supporting context was found for this parameter.",
          affectedFiles: reviewAffectedFiles,
          affectedSymbols: [parameter.name],
          evidence: [
            {
              kind: "parameter_source",
              detail: parameter.evidence ?? "source=invented",
              symbol: parameter.name,
            },
          ],
        }),
      );
    }
  }

  const references = Array.isArray(admittedOutput.references) ? admittedOutput.references : [];
  for (const reference of references) {
    const kind = reference?.kind;
    const name = typeof reference?.name === "string" ? reference.name.trim() : "";
    if (!name) {
      continue;
    }

    if (
      kind === "parameter" &&
      reference?.source === "invented" &&
      proposalExecutableTextUsesName(executableText, name)
    ) {
      issues.push(
        createReviewIssue({
          issueCode: "invented_parameter",
          message: `This parameter was invented: '${name}'.`,
          detail: "No supporting context was found for the referenced parameter.",
          affectedFiles: reviewAffectedFiles,
          affectedSymbols: [name],
          evidence: [
            {
              kind: "parameter_reference",
              detail: "reference.source=invented",
              symbol: name,
            },
          ],
        }),
      );
      continue;
    }

    if (kind === "parameter") {
      continue;
    }

    if (isSemantixMetadataReference(reference)) {
      continue;
    }

    if (kind === "file" || kind === "module") {
      const referencePath = resolveProposalPath(workspaceRoot, reference.path || name);
      const hasSupport = hasReferenceSupport({
        supportingContext,
        reference,
        name,
      });
      if (referencePath && createdTargetPaths.has(referencePath)) {
        evidence.push({
          kind: "planned_file",
          detail: `Reference '${name}' is created by this proposal.`,
          path: toWorkspaceRelativePath(workspaceRoot, referencePath),
          symbol: name,
        });
        continue;
      }
      if (
        referencePath &&
        (!isPathInsideWorkspace(workspaceRoot, referencePath) || !fileExists(referencePath))
      ) {
        issues.push(
          createReviewIssue({
            issueCode: "missing_supporting_context",
            message: `No supporting context was found for claimed dependency '${name}'.`,
            detail: reference.path || name,
            affectedFiles: reviewAffectedFiles,
            affectedSymbols: [name],
            evidence: [
              {
                kind: "dependency_reference",
                detail: reference.path || name,
                path: reference.path || name,
                symbol: name,
              },
            ],
            blocking: Boolean(reference.required ?? true),
          }),
        );
        continue;
      }
      if (!hasSupport && reference.required) {
        issues.push(
          createReviewIssue({
            issueCode: "missing_supporting_context",
            message: `No supporting context was found for claimed dependency '${name}'.`,
            detail: "The proposal claimed a dependency without listing supporting context.",
            affectedFiles: reviewAffectedFiles,
            affectedSymbols: [name],
            evidence: [
              {
                kind: "supporting_context",
                detail: "supporting_context did not include this dependency.",
                symbol: name,
              },
            ],
            blocking: true,
          }),
        );
      }
      continue;
    }

    if (!proposalExecutableTextUsesName(executableText, name)) {
      continue;
    }

    const symbolEvidence = findSymbolEvidence(workspaceRoot, name);
    if (!symbolEvidence) {
      issues.push(
        createReviewIssue({
          issueCode: "missing_symbol",
          message: `This step uses symbol '${name}' but no such symbol exists in the repo.`,
          detail: kind || "symbol",
          affectedFiles: reviewAffectedFiles,
          affectedSymbols: [name],
          evidence: [
            {
              kind: "symbol_lookup",
              detail: `No supporting context or repo symbol named '${name}' was found.`,
              symbol: name,
            },
          ],
        }),
      );
      continue;
    }

    evidence.push(symbolEvidence);
  }

  const dedupedIssues = dedupeReviewItems(
    issues,
    (issue) => `${issue.code}:${issue.message}:${issue.affectedSymbols?.join("|")}`,
  );
  const mergedEvidence = dedupeReviewItems(
    [...evidence, ...dedupedIssues.flatMap((issue) => normalizeReviewMetadataList(issue.evidence))],
    (entry) => `${entry.kind}:${entry.detail}:${entry.path}:${entry.symbol}`,
  );
  const interventions = dedupeReviewItems(
    dedupedIssues.flatMap((issue) => normalizeReviewMetadataList(issue.interventions)),
    (entry) => `${entry.kind}:${entry.detail}`,
  );
  const blockingIssue =
    dedupedIssues.find((issue) => issue.blocking) ??
    null;

  return {
    workspaceRoot,
    issues: dedupedIssues,
    evidence: mergedEvidence,
    interventions,
    blocking: Boolean(blockingIssue),
    blockingReason: blockingIssue?.summary ?? null,
    targetPath: targetPaths[0] ?? null,
    targetPaths,
    diffPreview: getProposalDiffPreview(admittedOutput),
  };
}

export function buildConstraintCatalog({ node, intent }) {
  const entries = [];
  let index = 1;

  for (const boundary of intent?.strictBoundaries ?? []) {
    entries.push({
      constraint_id: `intent.boundary.${index}`,
      kind: "hard",
      source: "intent",
      text: boundary,
    });
    index += 1;
  }

  for (const hardConstraint of node?.constraints?.hard ?? []) {
    entries.push({
      constraint_id: `node.constraint.hard.${index}`,
      kind: "hard",
      source: "node",
      text: hardConstraint,
    });
    index += 1;
  }

  for (const softConstraint of node?.constraints?.soft ?? []) {
    entries.push({
      constraint_id: `node.constraint.soft.${index}`,
      kind: "soft",
      source: "node",
      text: softConstraint,
    });
    index += 1;
  }

  return entries;
}

export function buildStrictCompilerSystemPrompt() {
  return `# SYSTEM DIRECTIVE: STRICT SEMANTIC ADMISSION

You are the semantic generation unit for the Semantix Control Plane.

You do not converse.
You do not explain.
You do not wrap output in tools, envelopes, markdown, or prose.

Your sole function is to read the provided semantic frame and emit one JSON value that matches the node hard_validation_schema exactly.

## OUTPUT CONTRACT

- Output raw JSON only
- The runtime parses the ENTIRE stdout as JSON
- Any extra characters before or after the JSON will cause immediate rejection
- Do not emit code fences
- Do not emit commentary
- Do not emit tool calls
- Do not emit retries, repairs, or alternate candidates

## VALIDATION CONTRACT

- The runtime validates your output in strict mode
- Missing required fields are rejected
- Extra properties are rejected
- Type mismatches are rejected
- Parse or schema mismatch ends execution immediately

## FINAL RULE

Return exactly one JSON document that satisfies the provided hard_validation_schema.

If the schema represents a code change proposal:
- emit either the legacy single-file shape or a CodeChangeSet with changes[]
- prefer CodeChangeSet for multi-file work
- include either diff_preview or content for modify_file changes
- diff_preview must be an applyable simple diff using +/-/space lines or a unified diff with numeric hunk ranges such as @@ -1,3 +1,4 @@
- use content for full-file replacements when exact hunk context is uncertain
- never use descriptive hunk headers such as @@ functionName; those are invalid
- include content for create_file changes
- include precondition_sha256 when replacing or deleting existing file contents from known bytes
- list referenced symbols explicitly
- mark invented parameters with source="invented"
- include supporting_context for claimed dependencies
- include ct_review_input when the schema requires it; lower the request into reasoning_chain, plan_steps, assumptions, numeric_claims, and concurrency so deterministic CT-MCP review can run before approval`;
}

export function buildStrictCompilerInput({
  runId,
  node,
  intent,
  artifact,
  hardValidationSchema,
  semanticFrameContext,
  constraintCatalog,
}) {
  return JSON.stringify(
    {
      SemanticAdmissionContract: {
        promptVersion: STRICT_COMPILER_PROMPT_VERSION,
        outputSchemaId: STRICT_COMPILER_OUTPUT_SCHEMA_ID,
        outputMode: "raw_json_only",
        strictValidation: true,
        noRetry: true,
        activeNodeId: node.id,
        hard_validation_schema: hardValidationSchema,
      },
      IntentContract: {
        id: intent?.id,
        primaryDirective: intent?.primaryDirective,
        strictBoundaries: intent?.strictBoundaries ?? [],
        successState: intent?.successState,
        artifactHash: intent?.artifactHash,
        planVersion: intent?.planVersion,
      },
      SemanticFrame: semanticFrameContext,
      Context: {
        run: {
          runId,
          artifactHash: artifact?.artifactHash,
          planVersion: artifact?.planVersion,
          graphVersion: artifact?.graphVersion,
        },
        activeNode: {
          id: node?.id,
          title: node?.title,
          inputSummary: node?.inputSummary,
          constraints: node?.constraints ?? {},
          capabilityScope: node?.capabilityScope ?? {},
          hard_validation_schema: hardValidationSchema,
        },
        constraintCatalog,
        stateEffectPreview: artifact?.plan?.stateEffects ?? [],
        approvalGates: (artifact?.plan?.approvalGates ?? []).filter((gate) => gate.targetNodeId === node?.id),
      },
      Task: "Return only raw JSON that matches hard_validation_schema exactly and is fully grounded in the provided semantic frame.",
    },
    null,
    2,
  );
}

export async function writeStrictCompilerInstructionsFile({ codexHome, runId, nodeId }) {
  const rootDir = codexHome ? join(codexHome, "semantix") : join(tmpdir(), "semantix");
  await mkdir(rootDir, { recursive: true });
  const path = join(
    rootDir,
    `strict-compiler-${String(runId).replaceAll(/[^a-zA-Z0-9._-]/g, "_")}-${String(nodeId).replaceAll(/[^a-zA-Z0-9._-]/g, "_")}-${randomUUID()}.md`,
  );
  await writeFile(path, buildStrictCompilerSystemPrompt(), "utf8");
  return path;
}

export function buildStrictCompilerContext({ runId, node, intent, artifact }) {
  const details = {
    runId,
    nodeId: node?.id,
    outputSchemaId: STRICT_COMPILER_OUTPUT_SCHEMA_ID,
  };
  const hardValidationSchema = getNodeHardValidationSchema(node, details);
  const semanticFrameContext = findSemanticFrameContext(node, artifact);
  const constraintCatalog = buildConstraintCatalog({
    node,
    intent,
  });

  return {
    hardValidationSchema,
    semanticFrameContext,
    constraintCatalog,
    input: buildStrictCompilerInput({
      runId,
      node,
      intent,
      artifact,
      hardValidationSchema,
      semanticFrameContext,
      constraintCatalog,
    }),
  };
}

export function normalizeStrictCompilerEnvelope({
  runId,
  node,
  stdout,
  hardValidationSchema,
  semanticFrameContext,
}) {
  const details = {
    runId,
    nodeId: node.id,
    outputSchemaId: STRICT_COMPILER_OUTPUT_SCHEMA_ID,
  };

  const admittedOutput = parseStrictJsonStdout(stdout, details);
  validateAgainstSchema(admittedOutput, hardValidationSchema, "$", details);

  const outputSummary = buildSemanticOutputSummary(admittedOutput, node);
  const diffPreview = getProposalDiffPreview(admittedOutput);
  const semanticReview = buildDeterministicCodeChangeReview({
    admittedOutput,
    semanticFrameContext,
  });

  return {
    executionStatus: "succeeded",
    outputSummary,
    stateEffects: [],
    riskSignals: [],
    checkpoint: {
      reason: "semantic_output_admitted",
    },
    admittedOutput,
    inspectorPatch: {
      proposedAction: {
        summary: outputSummary,
        kind: "code_change",
      },
      outputPreview: {
        summary: outputSummary,
        preview: JSON.stringify(admittedOutput, null, 2),
        diffPreview,
        structuredData: [],
      },
      critique: {
        summary:
          semanticReview.blockingReason ??
          "Semantic output admitted against the node hard_validation_schema.",
        blocking: semanticReview.blocking,
        issues: semanticReview.issues,
        evidence: semanticReview.evidence,
        interventions: semanticReview.interventions,
      },
      issues: semanticReview.issues,
      evidence: semanticReview.evidence,
      interventions: semanticReview.interventions,
      semanticReview,
      compiler: {
        promptVersion: STRICT_COMPILER_PROMPT_VERSION,
        outputSchemaId: STRICT_COMPILER_OUTPUT_SCHEMA_ID,
        hardValidationSchema,
        semanticFrameContext,
        admittedOutput,
      },
    },
  };
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, normalize, relative, resolve, sep } from "node:path";

import { ValidationError } from "../../core/src/contracts.js";
import { buildDeterministicCodeChangeReview } from "./strict-compiler.js";

function normalizeNewlines(value) {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function toLineRecord(content) {
  const normalized = normalizeNewlines(content);
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

function fromLineRecord(lines, hasTrailingNewline) {
  if (!lines.length) {
    return "";
  }

  const body = lines.join("\n");
  return hasTrailingNewline ? `${body}\n` : body;
}

function summarizeRelativePath(workspaceRoot, targetPath) {
  if (!workspaceRoot || !targetPath) {
    return targetPath ?? "workspace target";
  }

  const relativePath = relative(workspaceRoot, targetPath);
  return relativePath.startsWith(`..${sep}`) || relativePath === ".." ? targetPath : relativePath;
}

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getChangeSetOperations(admittedOutput) {
  const operations = Array.isArray(admittedOutput?.operations)
    ? admittedOutput.operations
    : Array.isArray(admittedOutput?.changes)
      ? admittedOutput.changes
      : [];

  return operations.filter(isObject);
}

function isCodeChangeSet(admittedOutput) {
  return getChangeSetOperations(admittedOutput).length > 0;
}

function normalizeOperationName(operation) {
  const value = String(operation?.operation ?? operation?.op ?? operation?.kind ?? "").trim();
  const map = {
    modify: "modify_file",
    create: "create_file",
    delete: "delete_file",
    rename: "rename_file",
  };
  return map[value] ?? value;
}

function resolveWorkspacePath(workspaceRoot, candidate, details, fieldName = "path") {
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new ValidationError(`CodeChangeSet operation requires a non-empty ${fieldName}.`, details);
  }

  const targetPath = normalize(resolve(workspaceRoot, candidate.trim()));
  if (targetPath !== workspaceRoot && !targetPath.startsWith(`${workspaceRoot}${sep}`)) {
    throw new ValidationError("CodeChangeSet operation target is outside the allowed workspace scope.", {
      ...details,
      fieldName,
      path: candidate,
      resolvedPath: targetPath,
      workspaceRoot,
    });
  }

  return targetPath;
}

function getOperationPath(operation) {
  return operation.workspace_path ?? operation.path ?? operation.file_path ?? operation.target_path;
}

function getRenameSourcePath(operation) {
  return operation.source_path ?? operation.from ?? operation.old_path ?? operation.workspace_path ?? operation.path;
}

function getRenameDestinationPath(operation) {
  return operation.new_workspace_path ?? operation.destination_path ?? operation.to ?? operation.new_path ?? operation.target_path;
}

function getOperationContent(operation) {
  for (const key of ["content", "new_content", "next_content"]) {
    if (typeof operation[key] === "string") {
      return operation[key];
    }
  }
  return null;
}

function getOperationDiff(operation) {
  for (const key of ["diff_preview", "diff", "patch"]) {
    if (typeof operation[key] === "string") {
      return operation[key];
    }
  }
  return null;
}

function createChangeSetValidationError(message, details = {}) {
  return new ValidationError(message, {
    ...details,
    reason: "invalid_code_change_set",
  });
}

function createDiffValidationError(message, details = {}) {
  return new ValidationError(message, {
    ...details,
    reason: "invalid_diff_preview",
  });
}

function assertExpectedLine(actual, expected, details) {
  if (actual !== expected) {
    throw createDiffValidationError("diff_preview did not match the current file contents.", {
      ...details,
      expected,
      actual: actual ?? null,
    });
  }
}

function normalizeDiffLines(diffPreview) {
  const lines = normalizeNewlines(diffPreview).split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function isUnifiedDiffMetadataLine(line) {
  return (
    !line ||
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  );
}

function toBareHunkSimpleDiff(diffPreview) {
  const diffLines = normalizeDiffLines(diffPreview);
  const simpleLines = [];
  let sawBareHunk = false;

  for (const line of diffLines) {
    if (isUnifiedDiffMetadataLine(line)) {
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

  return sawBareHunk ? simpleLines.join("\n") : null;
}

function applyUnifiedDiffPreview(currentContent, diffPreview, details) {
  const diffLines = normalizeDiffLines(diffPreview);
  const current = toLineRecord(currentContent);
  const output = [];
  let sourceIndex = 0;
  let lineIndex = 0;
  let addedLineCount = 0;
  let removedLineCount = 0;
  let hasTrailingNewline = current.hasTrailingNewline;
  let sawHunk = false;

  while (lineIndex < diffLines.length && !diffLines[lineIndex].startsWith("@@ ")) {
    const line = diffLines[lineIndex];
    if (isUnifiedDiffMetadataLine(line)) {
      lineIndex += 1;
      continue;
    }

    throw createDiffValidationError("Unsupported diff_preview metadata before the first hunk.", {
      ...details,
      line,
    });
  }

  while (lineIndex < diffLines.length) {
    const header = diffLines[lineIndex];
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!match) {
      throw createDiffValidationError("diff_preview included an invalid unified diff hunk header.", {
        ...details,
        header,
      });
    }

    sawHunk = true;
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
      if (prefix === " ") {
        assertExpectedLine(current.lines[sourceIndex], value, {
          ...details,
          line,
        });
        output.push(value);
        sourceIndex += 1;
        consumedOldLines += 1;
        lineIndex += 1;
        continue;
      }

      if (prefix === "-") {
        assertExpectedLine(current.lines[sourceIndex], value, {
          ...details,
          line,
        });
        sourceIndex += 1;
        consumedOldLines += 1;
        removedLineCount += 1;
        lineIndex += 1;
        continue;
      }

      if (prefix === "+") {
        output.push(value);
        addedLineCount += 1;
        lineIndex += 1;
        continue;
      }

      throw createDiffValidationError("diff_preview included an unsupported unified diff line.", {
        ...details,
        line,
      });
    }

    if (consumedOldLines !== oldCount) {
      throw createDiffValidationError("diff_preview hunk counts did not match the current file.", {
        ...details,
        expectedOldCount: oldCount,
        actualOldCount: consumedOldLines,
        header,
      });
    }
  }

  if (!sawHunk) {
    throw createDiffValidationError("diff_preview did not include any unified diff hunks.", details);
  }

  output.push(...current.lines.slice(sourceIndex));
  const nextHasTrailingNewline =
    output.length === 0 ? false : hasTrailingNewline || current.lines.length === 0;
  return {
    nextContent: fromLineRecord(output, nextHasTrailingNewline),
    addedLineCount,
    removedLineCount,
    mode: "unified_diff",
  };
}

function applySimpleDiffPreview(currentContent, diffPreview, details) {
  const diffLines = normalizeDiffLines(diffPreview);
  const current = toLineRecord(currentContent);
  const nextLines = [...current.lines];
  let addedLineCount = 0;
  let removedLineCount = 0;

  for (const line of diffLines) {
    if (!line) {
      continue;
    }

    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "+") {
      nextLines.push(value);
      addedLineCount += 1;
      continue;
    }

    if (prefix === "-") {
      const index = nextLines.indexOf(value);
      if (index === -1) {
        throw createDiffValidationError("diff_preview removal did not match the current file.", {
          ...details,
          line,
        });
      }
      nextLines.splice(index, 1);
      removedLineCount += 1;
      continue;
    }

    if (prefix === " ") {
      if (!nextLines.includes(value)) {
        throw createDiffValidationError("diff_preview context line did not match the current file.", {
          ...details,
          line,
        });
      }
      continue;
    }

    throw createDiffValidationError("diff_preview must use '+'/'-' lines or a unified diff hunk.", {
      ...details,
      line,
    });
  }

  const nextHasTrailingNewline =
    nextLines.length === 0 ? false : current.hasTrailingNewline || current.lines.length === 0;
  return {
    nextContent: fromLineRecord(nextLines, nextHasTrailingNewline),
    addedLineCount,
    removedLineCount,
    mode: "simple_diff",
  };
}

function applyDiffPreview(currentContent, diffPreview, details) {
  const normalizedDiff = normalizeNewlines(diffPreview);
  const bareHunkSimpleDiff = toBareHunkSimpleDiff(normalizedDiff);
  if (bareHunkSimpleDiff !== null) {
    return applySimpleDiffPreview(currentContent, bareHunkSimpleDiff, details);
  }

  const isUnifiedDiff =
    normalizedDiff.includes("\n@@ ") ||
    normalizedDiff.startsWith("@@ ") ||
    normalizedDiff.startsWith("--- ");

  return isUnifiedDiff
    ? applyUnifiedDiffPreview(currentContent, diffPreview, details)
    : applySimpleDiffPreview(currentContent, diffPreview, details);
}

async function readExistingContent(targetPath) {
  try {
    return await readFile(targetPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readPathState(targetPath) {
  try {
    const bytes = await readFile(targetPath);
    return {
      exists: true,
      content: bytes.toString("utf8"),
      sha256: hashContent(bytes),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        content: "",
        sha256: null,
      };
    }
    throw error;
  }
}

async function getBaseState(baseStates, targetPath) {
  if (!baseStates.has(targetPath)) {
    baseStates.set(targetPath, await readPathState(targetPath));
  }
  return baseStates.get(targetPath);
}

async function getStagedState(baseStates, stagedStates, targetPath) {
  if (stagedStates.has(targetPath)) {
    return stagedStates.get(targetPath);
  }

  const base = await getBaseState(baseStates, targetPath);
  const staged = {
    exists: base.exists,
    content: base.content,
  };
  stagedStates.set(targetPath, staged);
  return staged;
}

async function assertPrecondition(baseStates, targetPath, operation, details) {
  if (typeof operation.precondition_sha256 !== "string") {
    return null;
  }

  const base = await getBaseState(baseStates, targetPath);
  const expectedSha256 = operation.precondition_sha256.toLowerCase();
  if (!base.exists || base.sha256 !== expectedSha256) {
    throw createChangeSetValidationError("CodeChangeSet precondition_sha256 did not match current file bytes.", {
      ...details,
      targetPath,
      expectedSha256,
      actualSha256: base.sha256,
      fileExists: base.exists,
    });
  }

  return base.sha256;
}

function summarizeAppliedOperation(workspaceRoot, operation, targetPath, applied = {}) {
  const relativeTargetPath = summarizeRelativePath(workspaceRoot, targetPath);
  return {
    operation,
    target: relativeTargetPath,
    targetPath,
    relativeTargetPath,
    mode: applied.mode ?? operation,
    addedLineCount: applied.addedLineCount ?? 0,
    removedLineCount: applied.removedLineCount ?? 0,
  };
}

function assertKnownOperation(operationName, details) {
  const supported = new Set(["modify_file", "create_file", "delete_file", "rename_file"]);
  if (!supported.has(operationName)) {
    throw createChangeSetValidationError("CodeChangeSet operation is not supported by deterministic execution.", {
      ...details,
      operation: operationName,
      supported: [...supported],
    });
  }
}

async function stageModifyFile({
  operation,
  workspaceRoot,
  baseStates,
  stagedStates,
  details,
}) {
  const targetPath = resolveWorkspacePath(workspaceRoot, getOperationPath(operation), details);
  await assertPrecondition(baseStates, targetPath, operation, details);

  const staged = await getStagedState(baseStates, stagedStates, targetPath);
  if (!staged.exists) {
    throw createChangeSetValidationError("modify_file requires an existing file.", {
      ...details,
      targetPath,
    });
  }

  const diffPreview = getOperationDiff(operation);
  const nextContent = getOperationContent(operation);
  let applied;
  if (diffPreview !== null) {
    applied = applyDiffPreview(staged.content, diffPreview, {
      ...details,
      targetPath,
    });
  } else if (nextContent !== null) {
    applied = {
      nextContent,
      addedLineCount: 0,
      removedLineCount: 0,
      mode: "full_content",
    };
  } else {
    throw createChangeSetValidationError("modify_file requires diff_preview, diff, patch, or content.", {
      ...details,
      targetPath,
    });
  }

  staged.exists = true;
  staged.content = applied.nextContent;
  return summarizeAppliedOperation(workspaceRoot, "modify_file", targetPath, applied);
}

async function stageCreateFile({
  operation,
  workspaceRoot,
  baseStates,
  stagedStates,
  details,
}) {
  const targetPath = resolveWorkspacePath(workspaceRoot, getOperationPath(operation), details);
  const baseSha = await assertPrecondition(baseStates, targetPath, operation, details);
  const base = await getBaseState(baseStates, targetPath);
  const staged = await getStagedState(baseStates, stagedStates, targetPath);

  if ((base.exists || staged.exists) && !baseSha) {
    throw createChangeSetValidationError("create_file would overwrite an existing file without precondition_sha256.", {
      ...details,
      targetPath,
    });
  }

  const nextContent = getOperationContent(operation);
  if (nextContent === null) {
    throw createChangeSetValidationError("create_file requires content, new_content, or next_content.", {
      ...details,
      targetPath,
    });
  }

  staged.exists = true;
  staged.content = nextContent;
  return summarizeAppliedOperation(workspaceRoot, "create_file", targetPath, {
    mode: base.exists ? "preconditioned_overwrite" : "create",
    addedLineCount: toLineRecord(nextContent).lines.length,
    removedLineCount: base.exists ? toLineRecord(base.content).lines.length : 0,
  });
}

async function stageDeleteFile({
  operation,
  workspaceRoot,
  baseStates,
  stagedStates,
  details,
}) {
  const targetPath = resolveWorkspacePath(workspaceRoot, getOperationPath(operation), details);
  await assertPrecondition(baseStates, targetPath, operation, details);

  const staged = await getStagedState(baseStates, stagedStates, targetPath);
  if (!staged.exists) {
    throw createChangeSetValidationError("delete_file requires an existing source file.", {
      ...details,
      targetPath,
    });
  }

  const removedLineCount = toLineRecord(staged.content).lines.length;
  staged.exists = false;
  staged.content = "";
  return summarizeAppliedOperation(workspaceRoot, "delete_file", targetPath, {
    mode: "delete",
    removedLineCount,
  });
}

async function stageRenameFile({
  operation,
  workspaceRoot,
  baseStates,
  stagedStates,
  details,
}) {
  const sourcePath = resolveWorkspacePath(
    workspaceRoot,
    getRenameSourcePath(operation),
    details,
    "source_path",
  );
  const targetPath = resolveWorkspacePath(
    workspaceRoot,
    getRenameDestinationPath(operation),
    details,
    "destination_path",
  );
  await assertPrecondition(baseStates, sourcePath, operation, details);

  const source = await getStagedState(baseStates, stagedStates, sourcePath);
  if (!source.exists) {
    throw createChangeSetValidationError("rename_file requires an existing source file.", {
      ...details,
      sourcePath,
      targetPath,
    });
  }

  const target = await getStagedState(baseStates, stagedStates, targetPath);
  if (target.exists) {
    throw createChangeSetValidationError("rename_file destination already exists.", {
      ...details,
      sourcePath,
      targetPath,
    });
  }

  const content = source.content;
  source.exists = false;
  source.content = "";
  target.exists = true;
  target.content = content;
  return {
    operation: "rename_file",
    source: summarizeRelativePath(workspaceRoot, sourcePath),
    target: summarizeRelativePath(workspaceRoot, targetPath),
    sourcePath,
    targetPath,
    relativeSourcePath: summarizeRelativePath(workspaceRoot, sourcePath),
    relativeTargetPath: summarizeRelativePath(workspaceRoot, targetPath),
    mode: "rename",
    addedLineCount: 0,
    removedLineCount: 0,
  };
}

async function stageCodeChangeSet({ admittedOutput, workspaceRoot, runId, nodeId }) {
  const operations = getChangeSetOperations(admittedOutput);
  if (!operations.length) {
    throw createChangeSetValidationError("CodeChangeSet did not include any operations.", {
      runId,
      nodeId,
    });
  }

  const baseStates = new Map();
  const stagedStates = new Map();
  const effects = [];

  for (const [index, operation] of operations.entries()) {
    const operationName = normalizeOperationName(operation);
    const details = {
      runId,
      nodeId,
      operationIndex: index,
      operation: operationName,
    };
    assertKnownOperation(operationName, details);

    if (operationName === "modify_file") {
      effects.push(
        await stageModifyFile({ operation, workspaceRoot, baseStates, stagedStates, details }),
      );
      continue;
    }

    if (operationName === "create_file") {
      effects.push(
        await stageCreateFile({ operation, workspaceRoot, baseStates, stagedStates, details }),
      );
      continue;
    }

    if (operationName === "delete_file") {
      effects.push(
        await stageDeleteFile({ operation, workspaceRoot, baseStates, stagedStates, details }),
      );
      continue;
    }

    effects.push(
      await stageRenameFile({ operation, workspaceRoot, baseStates, stagedStates, details }),
    );
  }

  return {
    baseStates,
    stagedStates,
    effects,
  };
}

async function writeStagedCodeChangeSet({ stagedStates, baseStates }) {
  const writtenPaths = [];

  try {
    for (const [targetPath, staged] of stagedStates.entries()) {
      if (!staged.exists) {
        continue;
      }
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, staged.content, "utf8");
      writtenPaths.push(targetPath);
    }

    for (const [targetPath, staged] of stagedStates.entries()) {
      if (staged.exists) {
        continue;
      }
      await rm(targetPath, { force: true });
      writtenPaths.push(targetPath);
    }
  } catch (error) {
    await rollbackStagedWrites({ writtenPaths, baseStates });
    throw error;
  }
}

async function rollbackStagedWrites({ writtenPaths, baseStates }) {
  for (const targetPath of [...writtenPaths].reverse()) {
    const base = await getBaseState(baseStates, targetPath);
    try {
      if (base.exists) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, base.content, "utf8");
      } else {
        await rm(targetPath, { force: true });
      }
    } catch {
      // Preserve the original write failure; rollback is best-effort.
    }
  }
}

function buildCodeChangeSetResult({ admittedOutput, review, staged, runId, nodeId }) {
  const totalAddedLineCount = staged.effects.reduce((sum, effect) => sum + effect.addedLineCount, 0);
  const totalRemovedLineCount = staged.effects.reduce((sum, effect) => sum + effect.removedLineCount, 0);
  const relativeTargets = [
    ...new Set(
      staged.effects.flatMap((effect) =>
        [effect.relativeSourcePath, effect.relativeTargetPath].filter(Boolean),
      ),
    ),
  ];
  const lineSummary =
    totalAddedLineCount || totalRemovedLineCount
      ? `Applied ${totalAddedLineCount} addition(s) and ${totalRemovedLineCount} removal(s)`
      : "Applied structural file operation(s)";

  const execution = {
    status: "applied",
    workspaceRoot: review.workspaceRoot,
    operationCount: staged.effects.length,
    targetCount: relativeTargets.length,
    totalAddedLineCount,
    totalRemovedLineCount,
    effects: staged.effects,
    runId,
    nodeId,
  };

  return {
    outputSummary: `Recorded approved CodeChangeSet with ${staged.effects.length} operation(s). ${lineSummary}.`,
    stateEffect: {
      kind: "file_set",
      operation: "changeset",
      target: relativeTargets.join(", "),
      targets: relativeTargets,
      summary: admittedOutput?.summary ?? `Applied ${staged.effects.length} admitted file operation(s).`,
      diff: admittedOutput?.diff_preview ?? "",
      diffPreview: admittedOutput?.diff_preview ?? "",
      policyState: "pass",
      riskFlags: [],
      reversibility: {
        status: "reversible",
        mechanism: "local_file_transaction",
      },
      enforcement: {
        owner: "host",
        status: "pass",
        details: `${lineSummary} across ${staged.effects.length} operation(s).`,
      },
      effects: staged.effects,
      execution,
    },
    inspectorPatch: {
      execution,
    },
    auditDetails: execution,
  };
}

export async function applyAdmittedCodeChange({
  admittedOutput,
  semanticFrameContext,
  runId,
  nodeId,
} = {}) {
  const review = buildDeterministicCodeChangeReview({
    admittedOutput,
    semanticFrameContext,
  });

  if (isCodeChangeSet(admittedOutput)) {
    const staged = await stageCodeChangeSet({
      admittedOutput,
      workspaceRoot: review.workspaceRoot,
      runId,
      nodeId,
    });
    await writeStagedCodeChangeSet(staged);
    return buildCodeChangeSetResult({
      admittedOutput,
      review,
      staged,
      runId,
      nodeId,
    });
  }

  if (review.blocking) {
    throw new ValidationError("Admitted code change remained blocked at deterministic execution time.", {
      runId,
      nodeId,
      issues: review.issues,
    });
  }

  if (review.semanticOnly) {
    const execution = {
      status: "recorded",
      workspaceRoot: review.workspaceRoot,
      semanticOnly: true,
      runId,
      nodeId,
    };

    return {
      outputSummary: `Recorded approved semantic output. ${admittedOutput?.summary ?? "No summary provided."}`,
      stateEffect: {
        kind: "semantic_output",
        operation: "record",
        target: "semantix.semantic_output",
        targets: ["semantix.semantic_output"],
        summary: admittedOutput?.summary ?? "Recorded approved semantic output.",
        diff: admittedOutput?.diff_preview ?? "",
        diffPreview: admittedOutput?.diff_preview ?? "",
        policyState: "pass",
        riskFlags: [],
        reversibility: {
          status: "reversible",
          mechanism: "audit_record",
        },
        enforcement: {
          owner: "host",
          status: "pass",
          details: "Semantic output was recorded without modifying workspace files.",
        },
        execution,
      },
      inspectorPatch: {
        execution,
      },
      auditDetails: execution,
    };
  }

  if (!review.targetPath) {
    throw new ValidationError("Admitted code change did not include a target workspace_path.", {
      runId,
      nodeId,
    });
  }

  const previousContent = await readExistingContent(review.targetPath);
  const applied = applyDiffPreview(previousContent, admittedOutput?.diff_preview ?? "", {
    runId,
    nodeId,
    targetPath: review.targetPath,
  });

  await mkdir(dirname(review.targetPath), { recursive: true });
  await writeFile(review.targetPath, applied.nextContent, "utf8");

  const relativeTargetPath = summarizeRelativePath(review.workspaceRoot, review.targetPath);
  const lineSummary =
    applied.addedLineCount || applied.removedLineCount
      ? `Applied ${applied.addedLineCount} addition(s) and ${applied.removedLineCount} removal(s)`
      : "Applied a no-op diff";

  return {
    outputSummary: `Recorded approved code change for ${relativeTargetPath}. ${lineSummary}.`,
    stateEffect: {
      kind: "file",
      operation: "modify",
      target: relativeTargetPath,
      summary: admittedOutput?.summary ?? `Applied admitted code change to ${relativeTargetPath}.`,
      diff: admittedOutput?.diff_preview ?? "",
      diffPreview: admittedOutput?.diff_preview ?? "",
      policyState: "pass",
      riskFlags: [],
      reversibility: {
        status: "reversible",
        mechanism: "local_file_write",
      },
      enforcement: {
        owner: "host",
        status: "pass",
        details: `${lineSummary} via ${applied.mode}.`,
      },
      execution: {
        workspaceRoot: review.workspaceRoot,
        targetPath: review.targetPath,
        relativeTargetPath,
        mode: applied.mode,
        addedLineCount: applied.addedLineCount,
        removedLineCount: applied.removedLineCount,
      },
    },
    inspectorPatch: {
      execution: {
        status: "applied",
        workspaceRoot: review.workspaceRoot,
        targetPath: review.targetPath,
        relativeTargetPath,
        mode: applied.mode,
        addedLineCount: applied.addedLineCount,
        removedLineCount: applied.removedLineCount,
      },
    },
    auditDetails: {
      targetPath: review.targetPath,
      relativeTargetPath,
      mode: applied.mode,
      addedLineCount: applied.addedLineCount,
      removedLineCount: applied.removedLineCount,
    },
  };
}

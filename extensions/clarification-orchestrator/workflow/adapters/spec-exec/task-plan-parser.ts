export type ParsedTaskKind = "phase" | "task" | "checkpoint";

export type MalformedTaskPlanEntry = {
  lineNumber: number;
  reason: string;
  line?: string;
};

export type ParsedTask = {
  id: string;
  title: string;
  kind: ParsedTaskKind;
  optional: boolean;
  optionalInherited: boolean;
  completed: boolean;
  parentId?: string;
  requirementIds: string[];
  descriptionLines: string[];
  originalLine: string;
  lineNumber: number;
  indent: number;
  children: string[];
};

export type ParsedTaskPlan = {
  tasks: ParsedTask[];
  tasksSectionStartLine: number;
  tasksSectionEndLine: number;
  completedCount: number;
  remainingCount: number;
  optionalCount: number;
  malformed: MalformedTaskPlanEntry[];
};

type MutableParsedTask = ParsedTask;

const taskLinePattern = /^(?<indent>\s*)- \[(?<marker> |✅|x|X)\](?<optional>\*)?\s+(?<id>\d+(?:\.\d+)*)(?:\.)?\s+(?<title>.+?)\s*$/u;
const checkboxLikePattern = /^\s*- \[[^\]]*\]/u;
const requirementsPattern = /_Requirements:\s*([^_]+)_/iu;
const headingPattern = /^(#{1,6})\s+(.+)$/u;
const acceptedMarkerPattern = /^\s*- \[(?: |✅)\]\*?\s+\d+(?:\.\d+)*(?:\.)?\s+.+\s*$/u;
const checkpointKeywordPattern = /(?:\bcheckpoint\b|\bverify\b|检查点|验证)/iu;

export function isCheckpointTitle(title: string): boolean {
  return checkpointKeywordPattern.test(title);
}

export function parseTaskPlan(markdown: string): ParsedTaskPlan {
  const lines = markdown.split(/\r?\n/u);
  const malformed: MalformedTaskPlanEntry[] = [];
  const section = locateTasksSection(lines);
  if (!section) {
    return {
      tasks: [],
      tasksSectionStartLine: 0,
      tasksSectionEndLine: 0,
      completedCount: 0,
      remainingCount: 0,
      optionalCount: 0,
      malformed: [{ lineNumber: 0, reason: "missing-tasks-section" }],
    };
  }

  const tasks: MutableParsedTask[] = [];
  const byId = new Map<string, MutableParsedTask>();
  const lastTaskByDepth = new Map<number, MutableParsedTask>();
  let currentTask: MutableParsedTask | undefined;

  for (let index = section.startIndex + 1; index < section.endIndex; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const taskMatch = taskLinePattern.exec(line);

    if (checkboxLikePattern.test(line) && !taskMatch) {
      malformed.push({
        lineNumber,
        line,
        reason: acceptedMarkerPattern.test(line) ? "unparseable-task-numbering" : "invalid-checkbox-marker-or-task-line",
      });
      currentTask = undefined;
      continue;
    }

    if (taskMatch?.groups) {
      const indent = taskMatch.groups.indent.length;
      const id = taskMatch.groups.id;
      const title = taskMatch.groups.title.trim();
      const idParts = id.split(".");
      const depth = idParts.length;

      if (indent % 2 !== 0) {
        malformed.push({ lineNumber, line, reason: "ambiguous-nesting" });
      }
      if (depth > 2) {
        malformed.push({ lineNumber, line, reason: "unsupported-task-numbering-depth" });
      }
      if (depth === 1 && indent !== 0) {
        malformed.push({ lineNumber, line, reason: "phase-must-use-root-indentation" });
      }
      if (depth === 2 && indent <= 0) {
        malformed.push({ lineNumber, line, reason: "sub-task-must-be-indented" });
      }
      if (byId.has(id)) {
        malformed.push({ lineNumber, line, reason: "duplicate-task-id" });
      }

      const parentId = depth === 2 ? idParts[0] : undefined;
      const parent = parentId ? byId.get(parentId) : undefined;
      if (parentId && !parent) {
        malformed.push({ lineNumber, line, reason: "missing-parent-task" });
      }
      if (parent && indent <= parent.indent) {
        malformed.push({ lineNumber, line, reason: "ambiguous-parent-child-indentation" });
      }

      const explicitOptional = taskMatch.groups.optional === "*";
      const optionalInherited = Boolean(parent?.optional);
      const completed = taskMatch.groups.marker === "✅";
      const task: MutableParsedTask = {
        id,
        title,
        kind: depth === 1 && !isCheckpointTitle(title) ? "phase" : isCheckpointTitle(title) ? "checkpoint" : "task",
        optional: explicitOptional || optionalInherited,
        optionalInherited,
        completed,
        ...(parentId ? { parentId } : {}),
        requirementIds: [],
        descriptionLines: [],
        originalLine: line,
        lineNumber,
        indent,
        children: [],
      };

      tasks.push(task);
      byId.set(id, task);
      lastTaskByDepth.set(depth, task);
      for (const trackedDepth of Array.from(lastTaskByDepth.keys())) {
        if (trackedDepth > depth) lastTaskByDepth.delete(trackedDepth);
      }
      if (parent) parent.children.push(id);
      currentTask = task;
      continue;
    }

    if (line.trim().length === 0) continue;
    if (!currentTask) continue;

    const lineIndent = leadingWhitespaceLength(line);
    if (lineIndent <= currentTask.indent) continue;
    currentTask.descriptionLines.push(line);
    const requirementsMatch = requirementsPattern.exec(line);
    if (requirementsMatch?.[1]) {
      currentTask.requirementIds = unique([
        ...currentTask.requirementIds,
        ...requirementsMatch[1].split(",").map((entry) => entry.trim()).filter(Boolean),
      ]);
    }
  }

  for (const task of tasks) {
    const executable = task.kind !== "phase" || task.children.length === 0;
    if (executable && task.requirementIds.length === 0) {
      malformed.push({ lineNumber: task.lineNumber, line: task.originalLine, reason: "missing-executable-requirements" });
    }
  }

  return {
    tasks,
    tasksSectionStartLine: section.startIndex + 1,
    tasksSectionEndLine: section.endIndex,
    completedCount: tasks.filter((task) => task.completed).length,
    remainingCount: tasks.filter((task) => !task.completed).length,
    optionalCount: tasks.filter((task) => task.optional).length,
    malformed,
  };
}

function locateTasksSection(lines: string[]): { startIndex: number; endIndex: number } | undefined {
  const startIndex = lines.findIndex((line) => /^##\s+Tasks\s*$/iu.test(line));
  if (startIndex === -1) return undefined;
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = headingPattern.exec(lines[index] ?? "");
    if (match?.[1] && match[1].length <= 2) {
      endIndex = index;
      break;
    }
  }
  return { startIndex, endIndex };
}

function leadingWhitespaceLength(value: string): number {
  return value.length - value.trimStart().length;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export interface ParsedPatchFile {
  path: string;
  changeType: "add" | "modify" | "delete";
  additions: number;
  deletions: number;
}

const normalizeDiffPath = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().replace(/^"(.*)"$/u, "$1");
  if (trimmed === "/dev/null") {
    return undefined;
  }

  return trimmed.replace(/^[ab]\//u, "");
};

export function parseUnifiedDiff(diffText: string): ParsedPatchFile[] {
  const files: ParsedPatchFile[] = [];
  let current: ParsedPatchFile | null = null;

  const pushCurrent = () => {
    if (current) {
      files.push(current);
      current = null;
    }
  };

  diffText.split(/\r?\n/u).forEach((line) => {
    if (line.startsWith("diff --git ")) {
      pushCurrent();
      const parts = line.trim().split(/\s+/u);
      const beforePath = normalizeDiffPath(parts[2]);
      const afterPath = normalizeDiffPath(parts[3]);

      current = {
        path: afterPath ?? beforePath ?? "",
        changeType: beforePath ? afterPath ? "modify" : "delete" : "add",
        additions: 0,
        deletions: 0
      };
      return;
    }

    if (!current) {
      return;
    }

    if (line.startsWith("new file mode ")) {
      current.changeType = "add";
      return;
    }

    if (line.startsWith("deleted file mode ")) {
      current.changeType = "delete";
      return;
    }

    if (line.startsWith("--- ")) {
      const beforePath = normalizeDiffPath(line.slice(4));
      if (!beforePath) {
        current.changeType = "add";
      }
      return;
    }

    if (line.startsWith("+++ ")) {
      const afterPath = normalizeDiffPath(line.slice(4));
      if (afterPath) {
        current.path = afterPath;
      } else {
        current.changeType = "delete";
      }
      return;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
      return;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
    }
  });

  pushCurrent();

  return files.filter((file) => file.path.length > 0);
}

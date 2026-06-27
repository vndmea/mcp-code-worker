import { readScopedRepositoryFile } from "../repository/file-selection.js";

export const readRepositoryFile = async (
  path: string,
  rootDir = process.cwd()
): Promise<string> =>
  (
    await readScopedRepositoryFile(rootDir, path)
  ).content;

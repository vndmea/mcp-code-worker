import { spawn } from "node:child_process";

export type PathOpener = (targetPath: string) => Promise<boolean>;

export const openPathInSystemApp: PathOpener = async (
  targetPath: string
): Promise<boolean> => {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, [targetPath], {
      detached: true,
      stdio: "ignore"
    });

    child.on("error", () => {
      resolve(false);
    });
    child.on("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
};

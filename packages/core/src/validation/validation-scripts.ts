import type { AoConfig } from "../schemas/config.schema.js";

export type ValidationCheckName = "lint" | "test" | "typecheck";
export type ValidationScriptResolutionSource =
  | "canonical"
  | "configured"
  | "auto-discovered"
  | "missing";

export interface ValidationScriptResolution {
  checkName: ValidationCheckName;
  command?: string;
  scriptName?: string;
  source: ValidationScriptResolutionSource;
  triedScriptNames: string[];
}

const DEFAULT_SCRIPT_CANDIDATES: Record<ValidationCheckName, string[]> = {
  typecheck: [
    "typecheck",
    "type-check",
    "check-types",
    "types",
    "tsc"
  ],
  lint: [
    "lint",
    "lint:ci",
    "check:lint",
    "eslint",
    "biome",
    "check"
  ],
  test: [
    "test",
    "test:unit",
    "unit",
    "unit:test",
    "vitest",
    "jest"
  ]
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

const normalizeConfiguredScripts = (
  config: AoConfig["validation"] | undefined,
  checkName: ValidationCheckName
): string[] => config?.scripts?.[checkName] ?? [];

const findFirstScript = (
  availableScripts: Record<string, string>,
  candidates: string[]
): string | undefined => candidates.find((candidate) => Boolean(availableScripts[candidate]));

const buildCommand = (scriptName: string): string => `pnpm run ${scriptName}`;

export const resolveValidationScript = (
  availableScripts: Record<string, string>,
  config: AoConfig["validation"] | undefined,
  checkName: ValidationCheckName
): ValidationScriptResolution => {
  if (availableScripts[checkName]) {
    return {
      checkName,
      command: buildCommand(checkName),
      scriptName: checkName,
      source: "canonical",
      triedScriptNames: [checkName]
    };
  }

  const configuredScripts = normalizeConfiguredScripts(config, checkName);
  const configuredMatch = findFirstScript(availableScripts, configuredScripts);

  if (configuredMatch) {
    return {
      checkName,
      command: buildCommand(configuredMatch),
      scriptName: configuredMatch,
      source: "configured",
      triedScriptNames: unique([checkName, ...configuredScripts])
    };
  }

  if (config?.autoDiscover ?? true) {
    const discoveredMatch = findFirstScript(
      availableScripts,
      DEFAULT_SCRIPT_CANDIDATES[checkName]
    );

    if (discoveredMatch) {
      return {
        checkName,
        command: buildCommand(discoveredMatch),
        scriptName: discoveredMatch,
        source: "auto-discovered",
        triedScriptNames: unique([
          checkName,
          ...configuredScripts,
          ...DEFAULT_SCRIPT_CANDIDATES[checkName]
        ])
      };
    }
  }

  return {
    checkName,
    source: "missing",
    triedScriptNames: unique([
      checkName,
      ...configuredScripts,
      ...((config?.autoDiscover ?? true)
        ? DEFAULT_SCRIPT_CANDIDATES[checkName]
        : [])
    ])
  };
};

export const resolveValidationScripts = (
  availableScripts: Record<string, string>,
  config: AoConfig["validation"] | undefined
): Record<ValidationCheckName, ValidationScriptResolution> => ({
  typecheck: resolveValidationScript(availableScripts, config, "typecheck"),
  lint: resolveValidationScript(availableScripts, config, "lint"),
  test: resolveValidationScript(availableScripts, config, "test")
});

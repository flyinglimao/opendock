export type ZGStorageSelectMethod = "min" | "max" | "random";

const DEFAULT_EXPECTED_REPLICA = 2;
const DEFAULT_SELECT_METHOD: ZGStorageSelectMethod = "random";
const DEFAULT_SELECT_ATTEMPTS = 3;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseSelectMethod(value: string | undefined): ZGStorageSelectMethod {
  if (value === "min" || value === "max" || value === "random") return value;
  return DEFAULT_SELECT_METHOD;
}

export function getZGStorageExpectedReplica(): number {
  return parsePositiveInt(
    process.env.ZG_STORAGE_EXPECTED_REPLICA ??
      process.env.NEXT_PUBLIC_ZG_STORAGE_EXPECTED_REPLICA,
    DEFAULT_EXPECTED_REPLICA
  );
}

export function getZGStorageSelectMethod(): ZGStorageSelectMethod {
  return parseSelectMethod(
    process.env.ZG_STORAGE_SELECT_METHOD ??
      process.env.NEXT_PUBLIC_ZG_STORAGE_SELECT_METHOD
  );
}

export function getZGStorageSelectAttempts(): number {
  return parsePositiveInt(
    process.env.ZG_STORAGE_SELECT_ATTEMPTS ??
      process.env.NEXT_PUBLIC_ZG_STORAGE_SELECT_ATTEMPTS,
    DEFAULT_SELECT_ATTEMPTS
  );
}

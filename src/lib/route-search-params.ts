export type RouteSearchParams = Record<string, string | string[] | undefined> | undefined;

export function readSearchParam(params: RouteSearchParams, ...keys: string[]): string {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return "";
}

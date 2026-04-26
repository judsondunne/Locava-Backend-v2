export function buildRouteName(surface: string, action: string, method: string): string {
  return `${surface}.${action}.${method.toLowerCase()}`;
}

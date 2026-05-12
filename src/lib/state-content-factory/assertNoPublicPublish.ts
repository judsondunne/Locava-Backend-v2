export const PUBLIC_PUBLISH_NOT_IMPLEMENTED = "PUBLIC_PUBLISH_NOT_IMPLEMENTED";

export function assertNoPublicPublish(): void {
  throw new Error(PUBLIC_PUBLISH_NOT_IMPLEMENTED);
}

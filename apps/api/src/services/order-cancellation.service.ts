export const CANCELLATION_MARKER = "[Cancelado el ";

export function isCanceledOrderNotes(notes: string | null | undefined) {
  return notes?.includes(CANCELLATION_MARKER) ?? false;
}

export function revokePublicTrackingData() {
  return {
    publicTrackingToken: null,
    publicTrackingTokenCreatedAt: null,
  } as const;
}

export interface SnapshotFilters {
  projectId?: string;
  sessionId?: string;
}


interface SearchParamsReader {
  get(name: string): string | null;
}

export function snapshotFiltersFromSearchParams(params: SearchParamsReader): SnapshotFilters {
  return {
    ...readSearchParam(params, "projectId"),
    ...readSearchParam(params, "sessionId")
  };
}

function readSearchParam(params: SearchParamsReader, key: keyof SnapshotFilters): SnapshotFilters {
  const value = params.get(key)?.trim();
  return value ? { [key]: value } : {};
}

export function canRestoreSnapshot(snapshot: { projectId?: string | null }): boolean {
  return Boolean(snapshot.projectId);
}

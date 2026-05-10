interface RateModel {
  id: string;
}

export function syncUsageRateValues(
  current: Record<string, string>,
  models: RateModel[],
  rateByModel: ReadonlyMap<string, number>
) {
  const next: Record<string, string> = {};
  for (const model of models) {
    next[model.id] = String(rateByModel.get(model.id) ?? 0);
  }

  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (
    currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => current[key] === next[key])
  ) {
    return current;
  }

  return next;
}

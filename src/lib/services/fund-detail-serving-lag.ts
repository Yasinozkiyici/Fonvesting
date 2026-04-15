const DAY_MS = 86400000;

export function shouldDropServingRowForUniverseLag(input: {
  rowSnapshotMs: number;
  universeSnapshotMs: number;
  maxLagDays: number;
}): { lagDays: number; rowBehindUniverse: boolean; shouldDrop: boolean } {
  const lagDays = Math.floor((input.universeSnapshotMs - input.rowSnapshotMs) / DAY_MS);
  const rowBehindUniverse = lagDays >= 1;
  const shouldDrop = rowBehindUniverse && lagDays > input.maxLagDays;
  return { lagDays, rowBehindUniverse, shouldDrop };
}

// Typo suggestions: the closest of a list of names.

/** Edits between two names, a swap of neighbors counting as one. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The candidate closest to `name`, if close enough to be a typo. A leading `$` on a
 *  candidate is ignored. */
export function closest(
  name: string,
  candidates: readonly string[],
): string | null {
  let best: string | null = null;
  let bestDistance = Math.max(1, Math.floor(name.length / 3)) + 1;
  for (const candidate of candidates) {
    const distance = editDistance(
      name.toLowerCase(),
      candidate.replace(/^\$/, "").toLowerCase(),
    );
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function normalizeTitle(s = ""): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function diceCoefficient(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < na.length - 1; i++) {
    const bg = na.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }

  let hits = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    const bg = nb.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      hits++;
      bigrams.set(bg, count - 1);
    }
  }

  return (2 * hits) / (na.length + nb.length - 2);
}

const MODIFIERS = [
  "ova", "movie", "special", "specials", "tales", "journal", "part", "season", "kanwa", "spin-off", "theatre"
];

export function calculateCandidateScore(
  candidateTitle: string,
  candidateSlug: string,
  candidateJp: string | undefined,
  primaryEn?: string | null,
  primaryRom?: string | null,
  synonyms: string[] = []
): number {
  let score = 0;
  const candNorm = normalizeTitle(candidateTitle);
  const slugNorm = normalizeTitle(candidateSlug.replace(/-/g, " "));
  const candJpNorm = normalizeTitle(candidateJp || "");

  const normEn = normalizeTitle(primaryEn || "");
  const normRom = normalizeTitle(primaryRom || "");

  if (normEn && (candNorm === normEn || slugNorm === normEn)) score += 1000;
  if (normRom && (candNorm === normRom || slugNorm === normRom)) score += 900;
  if (normRom && candJpNorm === normRom) score += 800;

  const targetText = `${primaryEn || ""} ${primaryRom || ""} ${synonyms.join(" ")}`.toLowerCase();

  for (const mod of MODIFIERS) {
    const candHasMod = candNorm.includes(mod) || slugNorm.includes(mod);
    const targetHasMod = targetText.includes(mod);
    if (candHasMod && !targetHasMod) {
      score -= 300;
    }
  }

  const allTargets = [primaryEn, primaryRom, ...synonyms].filter(Boolean) as string[];
  for (const t of allTargets) {
    const normT = normalizeTitle(t);
    if (!normT || normT.length < 3) continue;

    const dice = Math.max(diceCoefficient(t, candidateTitle), diceCoefficient(t, candidateSlug.replace(/-/g, " ")));
    score += Math.round(dice * 250);

    if (candNorm.startsWith(normT) || normT.startsWith(candNorm)) score += 80;
    else if (candNorm.includes(normT) || normT.includes(candNorm)) score += 40;
  }

  const bestLen = (normEn || normRom || "").length;
  const lengthDiff = Math.abs(candNorm.length - bestLen);
  score -= lengthDiff * 2;

  return score;
}

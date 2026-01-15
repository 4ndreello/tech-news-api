const CODE_HOSTING_DOMAINS = [
  "github.com",
  "gist.github.com",
  "gitlab.com",
  "bitbucket.org",
  "sourceforge.net",
];

const MAX_SCORE_FOR_CODE_HOSTING = 60;

/**
 * Caps the tech score for URLs pointing to code hosting sites.
 * We want to prioritize articles and discussions over raw code.
 * @param score The original tech score.
 * @param url The URL of the news item.
 * @returns The (potentially capped) score.
 */
export function capScoreForCodeHostingSites(score: number, url?: string | null): number {
  if (!url) {
    return score;
  }

  const isCodeHosting = CODE_HOSTING_DOMAINS.some(domain => url.includes(domain));

  if (isCodeHosting) {
    return Math.min(score, MAX_SCORE_FOR_CODE_HOSTING);
  }

  return score;
}

import type { ChangeRequestTerms } from "./types";

export const GITLAB_TERMS: ChangeRequestTerms = { short: "MR", long: "merge request" };
export const GITHUB_TERMS: ChangeRequestTerms = { short: "PR", long: "pull request" };

export function titleCaseTerm(terms: ChangeRequestTerms): string {
  return terms.long.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function capitalizedTerm(terms: ChangeRequestTerms): string {
  return terms.long.charAt(0).toUpperCase() + terms.long.slice(1);
}

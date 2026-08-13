export class PatternEngine {
  matches(history: string, pattern: string): boolean {
    const normalizedHistory = history.toUpperCase();
    const normalizedPattern = pattern.toUpperCase();
    if (!normalizedPattern || normalizedPattern.length > normalizedHistory.length || /[^WL?]/.test(normalizedPattern)) return false;
    const candidate = normalizedHistory.slice(-normalizedPattern.length);
    return [...normalizedPattern].every((token, index) => token === '?' || token === candidate[index]);
  }
}

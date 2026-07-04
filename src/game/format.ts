const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc"];

/** compact big-number formatting: 1234567 -> "1.23M" */
export function formatNumber(n: number): string {
    if (!Number.isFinite(n)) return "∞";
    if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
    const exp = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
    const mantissa = n / Math.pow(1000, exp);
    return `${mantissa >= 100 ? mantissa.toFixed(0) : mantissa.toFixed(2)}${SUFFIXES[exp]}`;
}

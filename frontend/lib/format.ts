export const fmt = (n: number, digits = 0) =>
  Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

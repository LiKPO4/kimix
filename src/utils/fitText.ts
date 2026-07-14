export function fitFontSizeToWidth({
  availableWidth,
  requiredWidthAtBase,
  baseFontSize,
  minFontSize,
  step = 0.5,
}: {
  availableWidth: number;
  requiredWidthAtBase: number;
  baseFontSize: number;
  minFontSize: number;
  step?: number;
}): number {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(requiredWidthAtBase) ||
    !Number.isFinite(baseFontSize) ||
    !Number.isFinite(minFontSize) ||
    availableWidth <= 0 ||
    requiredWidthAtBase <= 0
  ) {
    return baseFontSize;
  }
  if (requiredWidthAtBase <= availableWidth) return baseFontSize;

  const safeStep = Number.isFinite(step) && step > 0 ? step : 0.5;
  const lowerBound = Math.min(baseFontSize, minFontSize);
  const fitted = baseFontSize * (availableWidth / requiredWidthAtBase);
  const stepped = Math.floor(fitted / safeStep) * safeStep;
  return Math.max(lowerBound, Math.min(baseFontSize, stepped));
}

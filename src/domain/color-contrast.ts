/** WCAG contrast helpers used by the design-token contract and its tests. */

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Unsupported color: ${hex}`);
  const [, redHex, greenHex, blueHex] = match;
  if (!redHex || !greenHex || !blueHex) throw new Error(`Unsupported color: ${hex}`);
  const red = channelToLinear(Number.parseInt(redHex, 16));
  const green = channelToLinear(Number.parseInt(greenHex, 16));
  const blue = channelToLinear(Number.parseInt(blueHex, 16));
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

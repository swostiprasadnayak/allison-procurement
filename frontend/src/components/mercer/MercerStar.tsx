/* eslint-disable @next/next/no-img-element */

interface MercerStarProps {
  /** Width & height in px. Defaults to 18 (the canonical inline size). */
  size?: number;
  className?: string;
}

/**
 * The Mercer AI glyph — the custom 4-point star SVG copied from the IRIS
 * asset set. Always use this for Mercer attribution; never Phosphor Sparkle.
 */
export function MercerStar({ size = 18, className }: MercerStarProps) {
  return (
    <img
      src="/ai-star-small.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}

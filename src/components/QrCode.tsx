import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;
const ERROR_CORRECTION = 'M';

/** One path of unit squares for every dark module, or null when the text cannot be encoded. */
function modulePath(text: string): { path: string; size: number } | null {
  try {
    const code = qrcode(0, ERROR_CORRECTION);
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    const cells: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col)) cells.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
      }
    }
    return { path: cells.join(''), size: count + QUIET_ZONE * 2 };
  } catch {
    return null;
  }
}

/** Drawn locally from the login link: nothing is sent to an image service. */
export function QrCode({ value, label }: { value: string; label: string }): JSX.Element {
  const drawing = useMemo(() => modulePath(value), [value]);
  if (!drawing) return <p role="alert">二维码生成失败，请刷新二维码重试。</p>;
  return (
    <svg
      className="music-qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${drawing.size} ${drawing.size}`}
      shapeRendering="crispEdges"
    >
      <rect width={drawing.size} height={drawing.size} fill="#fff" />
      <path d={drawing.path} fill="#000" />
    </svg>
  );
}

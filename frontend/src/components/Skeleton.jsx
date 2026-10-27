import React from 'react';

/** Shimmering placeholder block. Size it to match the content it replaces. */
export default function Skeleton({ w = '100%', h = '1rem', r, style }) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width: w, height: h, ...(r ? { borderRadius: r } : null), ...style }}
    />
  );
}

/** Placeholder table rows (use inside <tbody>). */
export function SkeletonRows({ rows = 5, cols = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={`sk-${i}`} aria-hidden="true">
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j}>
          <Skeleton w={j === 0 ? '70%' : j === cols - 1 ? '4.5rem' : '60%'} h="0.9rem" />
        </td>
      ))}
    </tr>
  ));
}

import React from 'react';

// Inline coffee-cup icon (Lucide "coffee"), drawn as a vector with the current
// text color so it renders identically across devices — unlike the ☕ emoji,
// whose glyph varies by platform font. Sizing/color come from CSS via
// `currentColor` and the element's font size.
export default function CoffeeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M10 2v2' />
      <path d='M14 2v2' />
      <path d='M6 2v2' />
      <path d='M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1' />
    </svg>
  );
}

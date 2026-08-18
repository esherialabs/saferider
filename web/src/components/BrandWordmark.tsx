const letters = [
  { value: 'S', className: 'brand-wordmark__letter--0' },
  { value: 'a', className: 'brand-wordmark__letter--1' },
  { value: 'f', className: 'brand-wordmark__letter--2' },
  { value: 'e', className: 'brand-wordmark__letter--3' },
  { value: 'R', className: 'brand-wordmark__letter--4' },
  { value: 'i', className: 'brand-wordmark__letter--5' },
  { value: 'd', className: 'brand-wordmark__letter--6' },
  { value: 'e', className: 'brand-wordmark__letter--7' },
] as const;

type BrandWordmarkProps = {
  className?: string;
  inverted?: boolean;
};

export default function BrandWordmark({ className = '', inverted = false }: BrandWordmarkProps) {
  return (
    <span className={`brand-wordmark ${inverted ? 'brand-wordmark--inverted' : ''} ${className}`}>
      <span className="sr-only">SafeRide</span>
      {letters.map((letter, index) => (
        <span
          key={`${letter.value}-${index}`}
          aria-hidden="true"
          className={`brand-wordmark__letter ${letter.className}`}
        >
          {letter.value}
        </span>
      ))}
    </span>
  );
}

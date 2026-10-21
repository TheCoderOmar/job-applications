import { useState } from 'react';

const SIZES = {
  sm: 'h-7 w-7 rounded-md text-xs',
  md: 'h-10 w-10 rounded-lg text-base',
  lg: 'h-14 w-14 rounded-xl text-2xl',
};

/** The company's stored logo, or its first letter while there is none (or it fails to load). */
export default function CompanyLogo({
  id,
  name,
  logoAt,
  size = 'md',
}: {
  id: number;
  name: string;
  logoAt: string | null;
  size?: keyof typeof SIZES;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const showImg = logoAt && broken !== logoAt;
  return showImg ? (
    <img
      src={`/api/companies/${id}/logo?v=${encodeURIComponent(logoAt)}`}
      alt=""
      loading="lazy"
      onError={() => setBroken(logoAt)}
      className={`${SIZES[size]} shrink-0 bg-white object-contain p-0.5`}
    />
  ) : (
    <div className={`${SIZES[size]} grid shrink-0 place-items-center bg-brand/15 font-semibold text-brand-light`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

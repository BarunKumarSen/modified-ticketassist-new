import React, { useState } from 'react';
import {
  Laptop,
  Server,
  Monitor,
  Armchair,
  Smartphone,
  Car,
  Printer,
  Network,
  Headphones,
  Package,
} from 'lucide-react';

interface AssetThumbnailProps {
  category: string;
  name: string;
  image?: string;
  compact?: boolean;
}

const CATEGORY_STYLE: Record<string, { bg: string; iconColor: string; label: string }> = {
  Laptop: { bg: 'from-slate-100 to-amber-50', iconColor: 'text-slate-700', label: 'Workstation' },
  Desktop: { bg: 'from-zinc-100 to-yellow-50', iconColor: 'text-zinc-700', label: 'Compute' },
  Monitor: { bg: 'from-sky-50 to-slate-100', iconColor: 'text-sky-700', label: 'Display' },
  Furniture: { bg: 'from-amber-50 to-stone-100', iconColor: 'text-amber-800', label: 'Office' },
  Mobile: { bg: 'from-indigo-50 to-slate-100', iconColor: 'text-indigo-700', label: 'Mobile' },
  Vehicle: { bg: 'from-emerald-50 to-amber-50', iconColor: 'text-emerald-800', label: 'Fleet' },
  Printer: { bg: 'from-stone-100 to-amber-50', iconColor: 'text-stone-700', label: 'Imaging' },
  Networking: { bg: 'from-cyan-50 to-slate-100', iconColor: 'text-cyan-800', label: 'Network' },
  Peripheral: { bg: 'from-violet-50 to-amber-50', iconColor: 'text-violet-700', label: 'Accessory' },
};

function CategoryIcon({ category, className }: { category: string; className: string }) {
  switch (category) {
    case 'Laptop':
      return <Laptop className={className} strokeWidth={1.6} />;
    case 'Desktop':
      return <Server className={className} strokeWidth={1.6} />;
    case 'Monitor':
      return <Monitor className={className} strokeWidth={1.6} />;
    case 'Furniture':
      return <Armchair className={className} strokeWidth={1.6} />;
    case 'Mobile':
      return <Smartphone className={className} strokeWidth={1.6} />;
    case 'Vehicle':
      return <Car className={className} strokeWidth={1.6} />;
    case 'Printer':
      return <Printer className={className} strokeWidth={1.6} />;
    case 'Networking':
      return <Network className={className} strokeWidth={1.6} />;
    case 'Peripheral':
      return <Headphones className={className} strokeWidth={1.6} />;
    default:
      return <Package className={className} strokeWidth={1.6} />;
  }
}

export const AssetThumbnail: React.FC<AssetThumbnailProps> = ({
  category,
  name,
  image,
  compact = false,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const style = CATEGORY_STYLE[category] || {
    bg: 'from-slate-100 to-amber-50',
    iconColor: 'text-slate-600',
    label: category || 'Asset',
  };

  if (image && !imgFailed) {
    return (
      <img
        src={image}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-full h-full object-cover"
      />
    );
  }

  return (
    <div
      className={`w-full h-full bg-gradient-to-br ${style.bg} flex flex-col items-center justify-center relative overflow-hidden select-none`}
    >
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '12px 12px',
        }}
      />
      <CategoryIcon
        category={category}
        className={`${compact ? 'w-5 h-5' : 'w-9 h-9'} ${style.iconColor} relative z-10`}
      />
      {!compact && (
        <span className="mt-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wider relative z-10">
          {style.label}
        </span>
      )}
    </div>
  );
};

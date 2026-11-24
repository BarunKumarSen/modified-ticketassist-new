import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import type { EmployeeCenterRecord } from '../types/policy';

interface SearchableCenterSelectProps {
  centers: EmployeeCenterRecord[];
  value: string;
  onChange: (cityName: string) => void;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  includeAllOption?: boolean;
  allOptionLabel?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export const SearchableCenterSelect: React.FC<SearchableCenterSelectProps> = ({
  centers,
  value,
  onChange,
  id,
  ariaLabel = 'Employee Center',
  placeholder = 'Select Indian city...',
  includeAllOption = false,
  allOptionLabel = 'All Centers',
  required = false,
  disabled = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedCenter = useMemo(
    () => centers.find((c) => c.name.toLowerCase() === (value || '').trim().toLowerCase()),
    [centers, value]
  );

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = centers.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.stateRegion.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
    const list: Array<{ key: string; label: string; sublabel?: string; value: string }> = [];
    if (includeAllOption && (!q || allOptionLabel.toLowerCase().includes(q))) {
      list.push({
        key: '__ALL__',
        label: allOptionLabel,
        sublabel: 'Organization-wide',
        value: allOptionLabel,
      });
    }
    for (const c of matched) {
      list.push({
        key: c.id,
        label: c.name,
        sublabel: c.stateRegion || 'India',
        value: c.name,
      });
    }
    return list;
  }, [centers, query, includeAllOption, allOptionLabel]);

  useEffect(() => {
    if (!open) return;
    setHighlightedIdx(0);
    const timer = setTimeout(() => searchInputRef.current?.focus(), 10);
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => Math.min(options.length - 1, prev + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) => Math.max(0, prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = options[highlightedIdx];
      if (picked) handleSelect(picked.value);
    }
  };

  const displayLabel = value
    ? selectedCenter
      ? `${selectedCenter.name} (${selectedCenter.stateRegion})`
      : value
    : '';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Hidden native input to preserve HTML required form validation if requested */}
      {required && (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => undefined}
          className="sr-only"
        />
      )}

      <button
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={`w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
          disabled ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'cursor-pointer hover:border-slate-400'
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className={`truncate ${displayLabel ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
            {displayLabel || placeholder}
          </span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 z-50 bg-white border border-slate-300 rounded-lg shadow-xl overflow-hidden min-w-[240px]">
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label={`Search ${ariaLabel}`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightedIdx(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search Indian city or state..."
              className="w-full text-xs bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear center search"
                onClick={() => setQuery('')}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <ul
            role="listbox"
            aria-label={`${ariaLabel} options`}
            className="max-h-56 overflow-y-auto divide-y divide-slate-50 py-1"
          >
            {options.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-400">
                No Indian center matching &ldquo;{query}&rdquo;
              </li>
            ) : (
              options.map((opt, idx) => {
                const isSelected = value.trim().toLowerCase() === opt.value.toLowerCase();
                const isHighlighted = idx === highlightedIdx;
                return (
                  <li key={opt.key} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => handleSelect(opt.value)}
                      onMouseEnter={() => setHighlightedIdx(idx)}
                      className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-50 text-emerald-900 font-semibold'
                          : isHighlighted
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <span className="block truncate">{opt.label}</span>
                        {opt.sublabel && (
                          <span className="block text-[10px] text-slate-400 truncate">{opt.sublabel}</span>
                        )}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 flex justify-between tabular-nums">
            <span>{options.length} location(s)</span>
            <span>India Master List</span>
          </div>
        </div>
      )}
    </div>
  );
};

"use client";

import type { ParcelFeature } from "@/lib/parcels/types";
import { formatArea } from "./format";

type Props = {
  parcels: ParcelFeature[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  onFocus: (parcel: ParcelFeature) => void;
  onRemove: (id: string) => void;
};

export function SelectedParcels({ parcels, highlightedId, onHighlight, onFocus, onRemove }: Props) {
  if (parcels.length === 0) {
    return <p className="selected-empty">Nie wybrano jeszcze działki.</p>;
  }

  const total = parcels.reduce((sum, p) => sum + p.properties.areaHa, 0);

  return (
    <div className="selected">
      <ul className="selected__list" aria-label="Wybrane działki">
        {parcels.map(p => {
          const { id, number, precinct, commune, areaHa } = p.properties;
          return (
            <li
              key={id}
              className="parcel"
              data-highlighted={highlightedId === id}
              onMouseEnter={() => onHighlight(id)}
              onMouseLeave={() => onHighlight(null)}
            >
              <button
                type="button"
                className="parcel__main"
                onClick={() => onFocus(p)}
                onFocus={() => onHighlight(id)}
                onBlur={() => onHighlight(null)}
                title="Pokaż na mapie"
              >
                <span className="parcel__swatch" aria-hidden="true" />
                <span className="parcel__text">
                  <span className="parcel__number">Działka {number}</span>
                  <span className="parcel__place">
                    {precinct}, gm. {commune}
                  </span>
                  <span className="parcel__id code">{id}</span>
                </span>
                <span className="parcel__area">{formatArea(areaHa)}</span>
              </button>
              <button
                type="button"
                className="parcel__remove"
                onClick={() => onRemove(id)}
                aria-label={`Usuń działkę ${number}`}
                title="Usuń"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
      {parcels.length > 1 && (
        <p className="selected__total">
          Razem <strong>{formatArea(total)}</strong>
        </p>
      )}
    </div>
  );
}

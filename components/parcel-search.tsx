"use client";

import { useId, useState, type FormEvent } from "react";
import type { ParcelFeature, ParcelsResponse } from "@/lib/parcels/types";
import { formatArea } from "./format";
import { revealOnSmallScreen } from "./reveal";

type Props = {
  selectedIds: Set<string>;
  onPick: (parcel: ParcelFeature) => void;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; query: string; results: ParcelFeature[] }
  | { status: "error"; message: string };

export function ParcelSearch({ selectedIds, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const inputId = useId();
  const hintId = useId();

  async function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/parcels?q=${encodeURIComponent(q)}`);
      const body = (await res.json()) as ParcelsResponse;
      if ("error" in body) setState({ status: "error", message: body.error });
      else setState({ status: "done", query: q, results: body.parcels });
    } catch {
      setState({ status: "error", message: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie." });
    }
  }

  function pick(parcel: ParcelFeature) {
    onPick(parcel);
    setState({ status: "idle" });
    setQuery("");
  }

  return (
    <div className="search">
      <label htmlFor={inputId} className="field-label">
        Numer działki
      </label>
      <form className="search__form" onSubmit={search} role="search">
        <input
          id={inputId}
          className="input search__input"
          type="search"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="np. Kobylniki 3/7"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={e => revealOnSmallScreen(e.currentTarget)}
          aria-describedby={hintId}
        />
        <button className="button button--secondary" type="submit" disabled={state.status === "loading"}>
          {state.status === "loading" ? "Szukam…" : "Szukaj"}
        </button>
      </form>
      <p id={hintId} className="hint">
        Nazwa obrębu i numer albo pełny identyfikator, np.{" "}
        <span className="code">040706_5.0020.3/7</span>.
      </p>

      <div aria-live="polite">
        {state.status === "error" && <p className="notice notice--error">{state.message}</p>}
        {state.status === "done" && state.results.length === 0 && (
          <p className="notice">
            Nie znaleziono działki „{state.query}”. Sprawdź numer albo wpisz nazwę obrębu przed numerem.
          </p>
        )}
        {state.status === "done" && state.results.length > 0 && (
          <ul className="results" aria-label="Znalezione działki">
            {state.results.map(p => {
              const selected = selectedIds.has(p.properties.id);
              return (
                <li key={p.properties.id}>
                  <button className="result" type="button" onClick={() => pick(p)}>
                    <span className="result__main">
                      <span className="result__number">Działka {p.properties.number}</span>
                      <span className="result__place">
                        {p.properties.precinct}, gm. {p.properties.commune}
                        {p.properties.county ? `, ${p.properties.county}` : ""}
                      </span>
                    </span>
                    <span className="result__side">
                      {selected ? "Wybrana" : formatArea(p.properties.areaHa)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

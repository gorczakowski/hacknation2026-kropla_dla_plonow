"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Place, PlacesResponse } from "@/lib/places/types";
import { revealOnSmallScreen } from "./reveal";

type Props = {
  onPick: (place: Place) => void;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; query: string; postcode: string | null; places: Place[] }
  | { status: "error"; message: string };

const DEBOUNCE_MS = 300;

/** "powiat inowrocławski"; cities that are their own powiat fall back to the voivodeship. */
function placeRegion(p: Place) {
  return p.county ?? (p.voivodeship ? `woj. ${p.voivodeship.replace(/^województwo /, "")}` : null);
}

/**
 * Village / postcode search with live suggestions (WAI-ARIA combobox pattern:
 * focus stays in the input, arrows move the active option, Enter picks it).
 */
export function PlaceSearch({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      request.current?.abort();
      setState({ status: "idle" });
      return;
    }
    const timer = setTimeout(async () => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setState({ status: "loading" });
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const body = (await res.json()) as PlacesResponse;
        if (controller.signal.aborted) return;
        if ("error" in body) setState({ status: "error", message: body.error });
        else
          setState({
            status: "done",
            query: q,
            postcode: body.mode === "postcode" ? body.postcode : null,
            places: body.places
          });
        setActive(-1);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie." });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const places = state.status === "done" ? state.places : [];
  const expanded = open && state.status !== "idle";

  // Keep the keyboard-active option visible in a long (postcode) list.
  useEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  function pick(place: Place) {
    onPick(place);
    setQuery(place.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && places.length) {
      e.preventDefault();
      setOpen(true);
      setActive(i => (i + 1) % places.length);
    } else if (e.key === "ArrowUp" && places.length) {
      e.preventDefault();
      setOpen(true);
      setActive(i => (i <= 0 ? places.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = places[active] ?? (places.length === 1 ? places[0] : undefined);
      if (choice) pick(choice);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className="search">
      <label htmlFor={inputId} className="field-label">
        Miejscowość lub kod pocztowy
      </label>
      <div className="combo">
        <input
          id={inputId}
          className="input"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          placeholder="np. Kobylniki albo 88-150"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={e => {
            setOpen(true);
            revealOnSmallScreen(e.currentTarget);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {state.status === "loading" && <span className="combo__spinner" aria-hidden="true" />}
      </div>
      <p id={hintId} className="hint">
        Wybierz miejscowość, a potem kliknij swoją działkę na mapie.
      </p>

      <div aria-live="polite">
        {expanded && state.status === "error" && <p className="notice notice--error">{state.message}</p>}
        {expanded && state.status === "done" && places.length === 0 && (
          <p className="notice">
            {state.postcode
              ? `Nie znaleziono miejscowości z kodem ${state.postcode}.`
              : `Nie znaleziono miejscowości „${state.query}”. Sprawdź pisownię albo wpisz kod pocztowy.`}
          </p>
        )}
      </div>

      <ul
        id={listId}
        role="listbox"
        className="results results--places"
        aria-label={state.status === "done" && state.postcode ? `Miejscowości z kodem ${state.postcode}` : "Miejscowości"}
        hidden={!expanded || places.length === 0}
      >
        {state.status === "done" && state.postcode && places.length > 0 && (
          <li role="presentation" className="results__caption">
            {places.length === 1 ? "1 miejscowość" : `${places.length} miejscowości`} z kodem {state.postcode}
          </li>
        )}
        {places.map((p, i) => (
          <li
            key={p.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className="result"
            data-active={i === active}
            // mousedown, not click: keeps focus in the input so blur does not close the list first.
            onMouseDown={e => {
              e.preventDefault();
              pick(p);
            }}
            onMouseEnter={() => setActive(i)}
          >
            <span className="result__main">
              <span className="result__number">{p.name}</span>
              <span className="result__place">{placeRegion(p)}</span>
            </span>
            {p.postcode && <span className="result__side">{p.postcode}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

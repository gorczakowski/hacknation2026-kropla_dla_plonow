"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MODULE_LABELS, type AnalysisResponse, type DataStatus } from "@/lib/analysis/contract";
import { CROPS, isCropId, type CropId } from "@/lib/crops";
import { earliestAnalysisDate, isValidAnalysisDate, todayInPoland } from "@/lib/dates";
import type { ParcelFeature, ParcelsResponse } from "@/lib/parcels/types";
import { parcelsAccusative } from "./format";
import type { MapFocus } from "./parcel-map";
import { ParcelSearch } from "./parcel-search";
import { SelectedParcels } from "./selected-parcels";

const ParcelMap = dynamic(() => import("./parcel-map").then(m => m.ParcelMap), {
  ssr: false,
  loading: () => <div className="map map--loading" aria-hidden="true" />
});

type Analysis =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; response: Exclude<AnalysisResponse, { error: string }> }
  | { status: "error"; message: string };

const STATUS_LABEL: Record<DataStatus, string> = {
  ok: "pobrano",
  partial: "częściowo",
  missing: "brak danych",
  error: "błąd źródła"
};

export function App() {
  const [parcels, setParcels] = useState<ParcelFeature[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [crop, setCrop] = useState<CropId | "">("");
  const [date, setDate] = useState(() => todayInPoland());
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>({ status: "idle" });
  const today = useMemo(() => todayInPoland(), []);
  const cropId = useId();
  const dateId = useId();

  const selectedIds = useMemo(() => new Set(parcels.map(p => p.properties.id)), [parcels]);

  // Bring a fresh result into view (it sits below the button, often off-screen).
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (analysis.status !== "done" && analysis.status !== "error") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [analysis.status]);

  // Any change of input makes an earlier result stale.
  useEffect(() => setAnalysis({ status: "idle" }), [parcels, crop, date]);

  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useCallback((text: string | null, ms = 4000) => {
    clearTimeout(messageTimer.current);
    setMapMessage(text);
    if (text) messageTimer.current = setTimeout(() => setMapMessage(null), ms);
  }, []);

  const focusOn = useCallback((p: ParcelFeature) => {
    setFocus(f => ({ bbox: p.properties.bbox, seq: (f?.seq ?? 0) + 1 }));
  }, []);

  const addParcel = useCallback(
    (p: ParcelFeature, { focus = true } = {}) => {
      setParcels(list => (list.some(x => x.properties.id === p.properties.id) ? list : [...list, p]));
      if (focus) focusOn(p);
    },
    [focusOn]
  );

  // Permalink: ?dzialki=<id>,<id>&uprawa=<crop>&data=<YYYY-MM-DD>. Restored once on load,
  // then kept in sync, so an analysis can be saved or shared as a link without accounts.
  const restored = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCrop = params.get("uprawa");
    const urlDate = params.get("data");
    if (isCropId(urlCrop)) setCrop(urlCrop);
    if (isValidAnalysisDate(urlDate)) setDate(urlDate);
    const ids = (params.get("dzialki") ?? "").split(",").filter(Boolean).slice(0, 10);
    if (ids.length === 0) {
      restored.current = true;
      return;
    }
    flash("Wczytuję działki z linku…", 15000);
    Promise.all(
      ids.map(id =>
        fetch(`/api/parcels?q=${encodeURIComponent(id)}`)
          .then(r => r.json() as Promise<ParcelsResponse>)
          .then(b => ("parcels" in b ? (b.parcels.find(p => p.properties.id === id) ?? null) : null))
          .catch(() => null)
      )
    ).then(found => {
      const list = found.filter((p): p is ParcelFeature => p !== null);
      setParcels(list);
      if (list.length > 0) {
        const [w, s, e, n] = list.reduce<[number, number, number, number]>(
          ([w, s, e, n], p) => {
            const [pw, ps, pe, pn] = p.properties.bbox;
            return [Math.min(w, pw), Math.min(s, ps), Math.max(e, pe), Math.max(n, pn)];
          },
          [180, 90, -180, -90]
        );
        setFocus(f => ({ bbox: [w, s, e, n], seq: (f?.seq ?? 0) + 1 }));
      }
      const lost = ids.length - list.length;
      flash(lost > 0 ? `Nie udało się wczytać ${parcelsAccusative(lost)} z linku.` : null, 6000);
      restored.current = true;
    });
  }, [flash]);

  useEffect(() => {
    if (!restored.current) return;
    const params = new URLSearchParams();
    if (parcels.length) params.set("dzialki", parcels.map(p => p.properties.id).join(","));
    if (crop) params.set("uprawa", crop);
    if (date && date !== today) params.set("data", date);
    const query = params.toString().replaceAll("%2C", ",").replaceAll("%2F", "/");
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [parcels, crop, date, today]);

  const removeParcel = useCallback((id: string) => {
    setParcels(list => list.filter(p => p.properties.id !== id));
    setHighlightedId(h => (h === id ? null : h));
  }, []);

  const pickAt = useCallback(
    async (lon: number, lat: number) => {
      flash("Szukam działki w tym miejscu…", 15000);
      try {
        const res = await fetch(`/api/parcels?lon=${lon.toFixed(7)}&lat=${lat.toFixed(7)}`);
        const body = (await res.json()) as ParcelsResponse;
        if ("error" in body) return flash(body.error, 6000);
        const parcel = body.parcels[0];
        if (!parcel) return flash("W tym miejscu nie ma działki w ewidencji.");
        addParcel(parcel, { focus: false });
        flash(`Dodano działkę ${parcel.properties.number}.`, 2500);
      } catch {
        flash("Brak połączenia z serwerem. Spróbuj ponownie.", 6000);
      }
    },
    [addParcel, flash]
  );

  const pickSelected = useCallback(
    (id: string) => {
      const p = parcels.find(x => x.properties.id === id);
      removeParcel(id);
      if (p) flash(`Usunięto działkę ${p.properties.number}.`, 2500);
    },
    [parcels, removeParcel, flash]
  );

  async function analyze() {
    setAnalysis({ status: "running" });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcelIds: parcels.map(p => p.properties.id), crop, date })
      });
      const body = (await res.json()) as AnalysisResponse;
      if ("error" in body) setAnalysis({ status: "error", message: body.error });
      else setAnalysis({ status: "done", response: body });
    } catch {
      setAnalysis({ status: "error", message: "Brak połączenia z serwerem. Spróbuj ponownie." });
    }
  }

  const hasParcels = parcels.length > 0;
  const ready = hasParcels && crop !== "" && date !== "";
  const missing = !hasParcels ? "Wybierz działkę." : crop === "" ? "Wybierz uprawę." : !date ? "Wybierz dzień." : null;

  return (
    <div className="app">
      <main className="panel">
        <header className="brand">
          <BrandMark />
          <div>
            <h1 className="brand__name">Zatrzymaj wodę</h1>
            <p className="brand__lede">Sprawdź, ile wody ma Twoja działka i jak zatrzymać ją w glebie.</p>
          </div>
        </header>

        <ol className="steps">
          <li className="step" data-done={hasParcels}>
            <h2 className="step__title">
              <StepMark n={1} done={hasParcels} />
              Działka
            </h2>
            <ParcelSearch selectedIds={selectedIds} onPick={p => addParcel(p)} />
            <SelectedParcels
              parcels={parcels}
              highlightedId={highlightedId}
              onHighlight={setHighlightedId}
              onFocus={focusOn}
              onRemove={removeParcel}
            />
          </li>

          <li className="step" data-done={crop !== ""}>
            <h2 className="step__title">
              <StepMark n={2} done={crop !== ""} />
              <label htmlFor={cropId}>Uprawa</label>
            </h2>
            <select
              id={cropId}
              className="input select"
              value={crop}
              onChange={e => setCrop(e.target.value as CropId | "")}
            >
              <option value="" disabled>
                Wybierz, co rośnie na działce
              </option>
              {CROPS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="hint">Jeśli uprawiasz kilka roślin, wybierz tę, która najbardziej cierpi z braku wody.</p>
          </li>

          <li className="step" data-done={date !== ""}>
            <h2 className="step__title">
              <StepMark n={3} done={date !== ""} />
              <label htmlFor={dateId}>Dzień analizy</label>
            </h2>
            <div className="date-row">
              <input
                id={dateId}
                className="input date"
                type="date"
                value={date}
                min={earliestAnalysisDate(today)}
                max={today}
                onChange={e => setDate(e.target.value)}
                required
              />
              {date !== today && (
                <button type="button" className="link-button" onClick={() => setDate(today)}>
                  Dzisiaj
                </button>
              )}
            </div>
            <p className="hint">Domyślnie dzisiaj. Możesz sprawdzić dowolny dzień z ostatnich 10 lat.</p>
          </li>
        </ol>

        <div className="actions">
          <button
            type="button"
            className="button button--primary button--wide"
            disabled={!ready || analysis.status === "running"}
            onClick={analyze}
            aria-describedby={missing ? "analyze-missing" : undefined}
          >
            {analysis.status === "running" ? "Analizuję…" : `Analizuj ${parcelsAccusative(parcels.length || 1)}`}
          </button>
          {missing && (
            <p id="analyze-missing" className="actions__missing">
              {missing}
            </p>
          )}
        </div>

        <div aria-live="polite" ref={resultRef} className="result-slot">
          {analysis.status === "error" && <p className="notice notice--error">{analysis.message}</p>}
          {analysis.status === "done" && (
            <section className="preview" aria-label="Wynik analizy">
              <h2 className="preview__title">Analiza w przygotowaniu</h2>
              <p className="preview__lede">
                Granice działek pobrano z ewidencji. Ocena wilgotności i rekomendacje pojawią się tu, gdy
                moduły danych będą gotowe.
              </p>
              <ul className="preview__modules">
                {analysis.response.results[0]?.modules.map(m => (
                  <li key={m.module} data-status={m.status}>
                    <span>{MODULE_LABELS[m.module]}</span>
                    <span className="preview__status">{STATUS_LABEL[m.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="panel__footer">
          Dane: GUGiK (ortofotomapa, ewidencja gruntów, ULDK), OpenStreetMap. Prototyp na HackNation 2026.
        </footer>
      </main>

      <section className="app__map" aria-label="Mapa działek">
        <ParcelMap
          parcels={parcels}
          highlightedId={highlightedId}
          onHighlight={setHighlightedId}
          onPickAt={pickAt}
          onPickSelected={pickSelected}
          focus={focus}
          message={mapMessage}
        />
      </section>
    </div>
  );
}

function StepMark({ n, done }: { n: number; done: boolean }) {
  return (
    <span className="step__mark" aria-hidden="true">
      {done ? (
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        n
      )}
    </span>
  );
}

/** A ditch seen from the side, water held back by a gate (zastawka): the product's whole idea. */
function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
      <path d="M4 14 V38 H44 V14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <rect x="5.5" y="19" width="17.5" height="17.5" className="brand__water" />
      <rect x="25" y="31" width="17.5" height="5.5" className="brand__water--low" />
      <rect x="22.5" y="8" width="3" height="29" rx="1" fill="currentColor" />
      <rect x="18" y="6" width="12" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

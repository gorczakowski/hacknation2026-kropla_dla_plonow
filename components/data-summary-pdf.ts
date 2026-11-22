/**
 * Parcel report, built in the browser from the /api/analyze response.
 * Downloading uses the same assessment and sources already shown in the app.
 */
import type { jsPDF as JsPdf } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import {
  COST_LABEL, EXCESS_WATER_LABEL, EXCESS_WATER_NOTE, FIELD_CHECK_LABEL, FIELD_OBSERVATIONS, FUNDING_LABEL, MODULE_LABELS,
  PRACTICE_KIND_LABELS, WATER_SCORE_LABELS, WATER_SCORE_NOTE, WATER_SCORE_SCALE, WATER_UNCERTAINTY_LABELS,
  type AnalysisRequest, type DataEnvelope, type DataStatus, type ModuleId, type ParcelAnalysis, type WaterAssessment
} from "@/lib/analysis/contract";
import { FUNDING_PAGE, RETENTION_GUIDE } from "@/lib/analysis/retention";
import type {
  HydroValue,
  LandCoverValue,
  LineFeatureSummary,
  MeteoValue,
  SatelliteValue,
  SoilValue,
  TerrainValue
} from "@/lib/analysis/values";
import { cropLabel } from "@/lib/crops";
import { formatDatePl } from "@/lib/dates";
import { KUS_2016, OPTIMAL_PRECIPITATION, OPTIMAL_PRECIPITATION_MONTHS, SOIL_WATER_RESERVE, type KusSoilCategory } from "@/lib/reference/kus2016";

export type SummaryInput = { request: AnalysisRequest; generatedAt: string; results: ParcelAnalysis[] };
export type FontFiles = { regular: ArrayBuffer; bold: ArrayBuffer };

const FONT = "Atkinson";
const PAGE_W = 210;
const PAGE_H = 297;
const M = 14; // margin, mm
const CONTENT_W = PAGE_W - 2 * M;
const INK: [number, number, number] = [22, 32, 27];
const MUTED: [number, number, number] = [86, 98, 91];
const WATER: [number, number, number] = [27, 94, 137];

const STATUS: Record<DataStatus, string> = {
  ok: "pobrano",
  partial: "dane częściowe",
  missing: "brak danych",
  error: "błąd źródła"
};

// ---------- formatting ----------

function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, " ");
}
const signed = (v: number | null | undefined, digits = 1) => (v !== null && v !== undefined && v > 0 ? `+${num(v, digits)}` : num(v, digits));
const pct = (share: number | null | undefined, digits = 0) => (share === null || share === undefined ? "—" : `${num(share * 100, digits)}%`);
const day = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const range = (from: string, to: string) => `${day(from)} – ${day(to)}`;
const metres = (v: number | null, radius: number) => (v === null ? `brak do ${num(radius, 0)} m` : `${num(v, 0)} m`);
const MONTHS = ["", "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// ---------- document writer ----------

type AutoTable = (doc: JsPdf, options: UserOptions) => void;

class Writer {
  y = M;
  constructor(
    public doc: JsPdf,
    private autoTable: AutoTable
  ) {}

  ensure(height: number) {
    if (this.y + height > PAGE_H - M - 8) this.newPage();
  }

  newPage() {
    this.doc.addPage();
    this.y = M;
  }

  text(content: string, { size = 9, bold = false, color = INK, gap = 1.5, indent = 0 } = {}) {
    const { doc } = this;
    doc.setFont(FONT, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(content, CONTENT_W - indent) as string[];
    const lineH = size * 0.42;
    for (const line of lines) {
      this.ensure(lineH);
      doc.text(line, M + indent, this.y + lineH * 0.8);
      this.y += lineH;
    }
    this.y += gap;
  }

  heading(content: string, status?: DataStatus) {
    this.ensure(16);
    this.y += 2;
    const { doc } = this;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.4);
    doc.line(M, this.y, PAGE_W - M, this.y);
    this.y += 1.5;
    doc.setFont(FONT, "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    doc.text(content, M, this.y + 4.5);
    if (status) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...(status === "ok" ? WATER : MUTED));
      doc.text(STATUS[status], PAGE_W - M, this.y + 4.5, { align: "right" });
    }
    this.y += 7.5;
  }

  sub(content: string) {
    this.ensure(10);
    this.text(content, { size: 9.5, bold: true, gap: 1 });
  }

  table(head: string[], body: (string | number)[][], options: Partial<UserOptions> = {}) {
    this.ensure(14);
    this.autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body: body.map(row => row.map(String)),
      margin: { left: M, right: M, bottom: M + 8 },
      theme: "grid",
      styles: { font: FONT, fontSize: 8, cellPadding: 1.4, textColor: INK, lineColor: [200, 206, 202], lineWidth: 0.15 },
      headStyles: { font: FONT, fontStyle: "bold", fillColor: [236, 240, 236], textColor: INK },
      ...options
    });
    this.y = ((this.doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? this.y) + 2.5;
  }

  pairs(rows: [string, string][]) {
    this.table(["", ""], rows, {
      showHead: false,
      columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" } }
    });
  }

  notes(envelope: DataEnvelope | undefined) {
    if (!envelope) return;
    for (const note of envelope.notes) this.text(`• ${note}`, { size: 7.5, color: MUTED, gap: 0.6, indent: 1 });
    this.y += 1.5;
  }
}

// ---------- sections ----------

function meteoSection(w: Writer, env: DataEnvelope<MeteoValue>, crop: AnalysisRequest["crop"], soil: SoilValue | null) {
  const v = env.value;
  if (!v) return;
  const source = v.provider === "open-meteo-era5" ? "ERA5 / ERA5-Land (Open-Meteo)" : "NASA POWER (MERRA-2), ET0 liczone FAO-56";
  w.text(
    `Źródło: ${source}. Punkt siatki ${num(v.gridPoint.lat, 2)}° N, ${num(v.gridPoint.lon, 2)}° E. Ostatni dzień danych: ${day(v.lastDay)}.`,
    { size: 8.5 }
  );

  w.sub("Okresy kończące się w ostatnim dniu danych");
  w.table(
    ["Okres", "Opad [mm]", "ET0 [mm]", "Bilans P−ET0 [mm]", "Śr. temp. [°C]", "Dni z opadem ≥1 mm", "Najdłuższy okres bez opadu [dni]", "Dni ≥30 °C"],
    v.windows.map(x => [
      `${x.days} dni (${range(x.from, x.to)})`,
      num(x.precipitation),
      num(x.et0),
      signed(x.balance),
      num(x.tMean),
      x.wetDays,
      x.longestDrySpell,
      x.hotDays
    ])
  );

  if (v.sameWindow.length) {
    w.sub("Te same 60 dni w poprzednich latach");
    w.table(
      ["Rok", "Okres", "Opad [mm]", "ET0 [mm]", "Bilans P−ET0 [mm]"],
      v.sameWindow.map(x => [x.year, range(x.from, x.to), num(x.precipitation), num(x.et0), signed(x.balance)])
    );
    if (v.sameWindowRank) {
      w.text(
        `Bilans 60 dni w ${v.sameWindow[0].year} r. jest ${v.sameWindowRank.rank}. najniższy spośród ${v.sameWindowRank.of} porównywanych lat (1 = najbardziej suchy).`,
        { size: 8.5 }
      );
    }
  }

  if (v.seasons.length) {
    w.sub("Sezony wegetacyjne (1 kwietnia – 30 września)");
    w.table(
      ["Rok", "Opad [mm]", "ET0 [mm]", "Bilans P−ET0 [mm]", "Najdłuższy okres bez opadu [dni]", "Dni ≥30 °C", "Uwagi"],
      v.seasons.map(s => [
        s.year,
        num(s.precipitation),
        num(s.et0),
        signed(s.balance),
        s.longestDrySpell,
        s.hotDays,
        s.complete ? "" : `do ${day(s.to)}`
      ])
    );
  }

  if (v.seasonMonths.length) {
    const optimum = OPTIMAL_PRECIPITATION[crop];
    const category = (soil?.kusCategory ?? null) as KusSoilCategory | null;
    const adjust = category ? SOIL_WATER_RESERVE[category].adjust : 1;
    const year = v.seasonMonths[0].month.slice(0, 4);
    w.sub(`Opady miesięczne w sezonie ${year}`);
    const head = ["Miesiąc", "Opad [mm]", "ET0 [mm]", "Bilans [mm]"];
    if (optimum) head.push(`Optymalny opad: ${optimum.crop} [mm]`);
    w.table(
      head,
      v.seasonMonths.map(m => {
        const month = Number(m.month.slice(5, 7));
        const row: string[] = [
          `${MONTHS[month]}${m.complete ? "" : " (niepełny)"}`,
          num(m.precipitation),
          num(m.et0),
          signed(m.precipitation - m.et0)
        ];
        if (optimum) {
          const base = optimum.months[OPTIMAL_PRECIPITATION_MONTHS.indexOf(month)];
          row.push(base === null || base === undefined ? "—" : num(base * adjust, 0));
        }
        return row;
      })
    );
    if (optimum) {
      w.text(
        `Optymalny opad wg Dzieżyca (1989), za: ${KUS_2016.citation}, tab. 3.` +
          (category && adjust !== 1
            ? ` Wartości ${adjust > 1 ? "zwiększone" : "zmniejszone"} o 20% dla gleby ${category} (przypis do tabeli).`
            : ""),
        { size: 7.5, color: MUTED }
      );
    }
  }
}

function soilSection(w: Writer, env: DataEnvelope<SoilValue>) {
  const v = env.value;
  if (!v) return;
  w.table(
    ["Warstwa", "Piasek [%]", "Pył [%]", "Ił [%]", "Węgiel org. [g/kg]", "pH (H2O)"],
    [
      ...v.layers.map(l => [l.depth.replace("cm", " cm"), num(l.sand), num(l.silt), num(l.clay), num(l.soc), num(l.ph)]),
      ["0–30 cm (średnia ważona)", num(v.topsoil.sand), num(v.topsoil.silt), num(v.topsoil.clay), num(v.topsoil.soc), num(v.topsoil.ph)]
    ]
  );
  const category = v.kusCategory as KusSoilCategory | null;
  const ref = category ? SOIL_WATER_RESERVE[category] : null;
  w.pairs([
    ["Klasa uziarnienia (USDA)", v.texture ? `${v.texture.pl} (${v.texture.usda})` : "—"],
    ["Kategoria gleby (przybliżenie)", category ?? "—"],
    ["Woda dostępna 0–100 cm (SoilGrids)", v.availableWater0to100 === null ? "—" : `${num(v.availableWater0to100, 0)} mm`],
    [
      "Dla porównania: Kuś (2016), tab. 4",
      ref ? `gleba ${category}, warstwa 0–150 cm: PPW ${ref.ppw} mm, WTW ${ref.wtw} mm, woda dostępna ${ref.wod} mm` : "—"
    ]
  ]);
  w.table(
    ["Warstwa", "Wilgotność przy pF 2,5 [mm/m]", "Wilgotność przy pF 4,2 [mm/m]", "Woda dostępna w warstwie [mm]"],
    v.waterLayers.map(l => [
      l.depth === "5-15cm" ? "0–15 cm (wartość z 5–15 cm)" : l.depth.replace("cm", " cm"),
      num(l.fieldCapacity, 0),
      num(l.wiltingPoint, 0),
      l.fieldCapacity !== null && l.wiltingPoint !== null ? num(((l.fieldCapacity - l.wiltingPoint) * l.thicknessCm) / 100, 0) : "—"
    ])
  );
}

function satelliteSection(w: Writer, env: DataEnvelope<SatelliteValue>) {
  const v = env.value;
  if (!v) return;
  const rows = [v.current, ...v.history].map((x, i) => {
    const o = x.observation;
    return [
      i === 0 ? `${x.year} (analiza)` : String(x.year),
      range(x.from, x.to),
      o ? day(o.date) : `brak (${x.candidates} scen)`,
      o ? `${o.sceneCloud}%` : "—",
      o ? pct(o.clearShare) : "—",
      o ? num(o.ndvi, 2) : "—",
      o ? num(o.ndmi, 2) : "—"
    ];
  });
  w.table(["Rok", "Okno", "Obserwacja", "Chmury w scenie", "Czyste piksele działki", "NDVI", "NDMI"], rows);
  const cur = v.current.observation;
  w.pairs([
    ["NDVI: obecnie / mediana lat poprzednich", `${num(cur?.ndvi, 2)} / ${num(v.ndviHistoryMedian, 2)}` + (cur?.ndvi != null && v.ndviHistoryMedian !== null ? ` (różnica ${signed(cur.ndvi - v.ndviHistoryMedian, 2)})` : "")],
    ["NDMI: obecnie / mediana lat poprzednich", `${num(cur?.ndmi, 2)} / ${num(v.ndmiHistoryMedian, 2)}` + (cur?.ndmi != null && v.ndmiHistoryMedian !== null ? ` (różnica ${signed(cur.ndmi - v.ndmiHistoryMedian, 2)})` : "")]
  ]);
}

function terrainSection(w: Writer, env: DataEnvelope<TerrainValue>) {
  const v = env.value;
  if (!v) return;
  w.pairs([
    ["Wysokość na działce (min / śr. / maks.)", `${num(v.elevation.min)} / ${num(v.elevation.mean)} / ${num(v.elevation.max)} m n.p.m.`],
    ["Spadek terenu (średni / maks.)", `${num(v.slopePct.mean)}% / ${num(v.slopePct.max)}%`],
    ["Powierzchnia o spadku > 5%", pct(v.steepShare)],
    [`Otoczenie ${v.surroundings.radiusM} m (min / śr. / maks.)`, `${num(v.surroundings.min)} / ${num(v.surroundings.mean)} / ${num(v.surroundings.max)} m n.p.m.`],
    ["Działka względem otoczenia", `${signed(v.relativeElevation)} m: ${v.position}`],
    ["Kierunek spływu po działce", v.drainsTowards ?? "brak wyraźnego spadku"],
    ["Najniższy punkt działki", `${num(v.lowestPoint[1], 5)}° N, ${num(v.lowestPoint[0], 5)}° E`],
    ["Model i oczko", `${v.dataset}, ${v.cellSizeM[0]}×${v.cellSizeM[1]} m (${v.parcelCells} oczek na działce)`]
  ]);
}

function hydroSection(w: Writer, env: DataEnvelope<HydroValue>) {
  const v = env.value;
  if (!v) return;
  const line = (label: string, s: LineFeatureSummary) => [
    label,
    metres(s.nearestM, v.searchRadiusM),
    [s.nearestKind, s.nearestName].filter(Boolean).join(", ") || "—",
    num(s.lengthInside, 0),
    num(s.length100, 0),
    num(s.length500, 0),
    s.count500
  ];
  w.table(
    ["Obiekt", "Najbliższy", "Rodzaj / nazwa", "Długość na działce [m]", "do 100 m [m]", "do 500 m [m]", "Liczba do 500 m"],
    [line("Rowy melioracyjne", v.ditches), line("Rzeki i strumienie", v.watercourses), line("Kanały", v.canals)]
  );
  const b = v.waterBodies;
  w.pairs([
    [
      "Najbliższa woda powierzchniowa",
      b.nearestM === null
        ? `brak w promieniu ${v.searchRadiusM} m`
        : `${b.nearestM === 0 ? "na działce lub przy granicy" : `${num(b.nearestM, 0)} m`}: ${[b.nearestKind, b.nearestName].filter(Boolean).join(", ")}, ${num(b.nearestAreaHa, 2)} ha`
    ],
    ["Wody w promieniu 500 m", `${b.count500} obiektów (w tym ${b.standing500} wód stojących), łącznie ${num(b.areaHa500, 2)} ha`]
  ]);
}

function landcoverSection(w: Writer, env: DataEnvelope<LandCoverValue>) {
  const v = env.value;
  if (!v) return;
  // Parcel classes first, then the ring's; the catch-all rows last.
  const last = (l: string) => l.startsWith("inne") || l.startsWith("brak");
  const all = [...new Set([...v.parcel.map(s => s.label), ...v.ring.map(s => s.label)])];
  const labels = [...all.filter(l => !last(l)), ...all.filter(last)];
  const share = (list: LandCoverValue["parcel"], label: string) => pct(list.find(s => s.label === label)?.share ?? 0, 1);
  w.table(
    ["Klasa pokrycia terenu (BDOT10k)", "Na działce", `W pasie ${v.radiusM} m`],
    labels.map(l => [l, share(v.parcel, l), share(v.ring, l)])
  );
}

function assessmentSection(w: Writer, assessment: WaterAssessment) {
  w.heading("Uzasadnienie oceny warunków wodnych");
  w.text(assessment.summary);
  if (assessment.excessWater) w.text(`${EXCESS_WATER_LABEL}. ${EXCESS_WATER_NOTE}`, { bold: true });
  if (assessment.uncertainty) {
    w.text(`Niepewność oceny jest ${WATER_UNCERTAINTY_LABELS[assessment.uncertainty]}.`, { size: 8.5, color: MUTED });
  }
  for (const evidence of assessment.evidence) w.text(`• ${evidence}`, { size: 8.5, indent: 1 });
  if (assessment.score === null) return;

  w.heading("Zalecenia retencyjne i agrotechniczne");
  if (!assessment.recommendations.length) {
    w.text("W dostępnych danych brak podstaw do wskazania konkretnego zabiegu. Obserwacje z pola mogą uzupełnić wynik.");
  }
  for (const practice of assessment.recommendations) {
    w.ensure(30);
    const kind = PRACTICE_KIND_LABELS[practice.kind];
    w.text(`${kind}${practice.needsCheck ? ` · ${FIELD_CHECK_LABEL}` : ""}`, { size: 8, color: MUTED, gap: 0.5 });
    w.sub(practice.title);
    w.text(practice.why);
    w.text(practice.nextStep);
    w.text(`${COST_LABEL}: ${practice.cost} Poradnik, s. ${practice.sourcePage}.`, { size: 8, color: MUTED, gap: practice.funding ? 0.5 : 3 });
    if (practice.funding) {
      w.text(`${FUNDING_LABEL}: ${practice.funding} Poradnik, s. ${FUNDING_PAGE}.`, { size: 8, color: MUTED, gap: 3 });
    }
  }
}

// ---------- document ----------

export function buildDataSummaryPdf(jsPDF: typeof JsPdf, autoTable: AutoTable, input: SummaryInput, fonts: FontFiles): JsPdf {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS("AtkinsonHyperlegible-Regular.ttf", toBase64(fonts.regular));
  doc.addFileToVFS("AtkinsonHyperlegible-Bold.ttf", toBase64(fonts.bold));
  doc.addFont("AtkinsonHyperlegible-Regular.ttf", FONT, "normal");
  doc.addFont("AtkinsonHyperlegible-Bold.ttf", FONT, "bold");
  doc.setProperties({ title: "Ocena warunków wodnych – Zatrzymaj wodę", creator: "Zatrzymaj wodę (HackNation 2026)" });

  const w = new Writer(doc, autoTable);
  const { request, results } = input;
  const generated = new Date(input.generatedAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });

  w.text("Ocena warunków wodnych", { size: 20, bold: true, gap: 1 });
  w.text(`${formatDatePl(request.date)} · ${cropLabel(request.crop)}`, { size: 10, color: MUTED, gap: 4 });
  w.table(["Działka", "Ocena na dzień analizy", "Podstawa oceny"], results.map(({ parcel, assessment }) => [
    `${parcel.properties.number}, obręb ${parcel.properties.precinct}\n${parcel.properties.id}`,
    (assessment.score === null ? "Brak oceny" : `${assessment.score}/5\n${WATER_SCORE_LABELS[assessment.score]}`) +
      (assessment.excessWater ? `\n${EXCESS_WATER_LABEL}` : ""),
    assessment.summary
  ]), {
    rowPageBreak: "avoid",
    columnStyles: { 0: { cellWidth: 53 }, 1: { cellWidth: 38, fontStyle: "bold", textColor: WATER } }
  });
  w.text(WATER_SCORE_SCALE, { size: 8.5, bold: true });
  w.text(WATER_SCORE_NOTE, { size: 8.5, color: MUTED });
  w.text(`Wygenerowano ${generated}`, { size: 8, color: MUTED });

  results.forEach((result, i) => {
    if (i > 0 || results.length > 1) w.newPage();
    const p = result.parcel.properties;
    const env = <T>(id: ModuleId) => result.modules.find(m => m.module === id) as DataEnvelope<T> | undefined;

    w.y += 2;
    w.ensure(36);
    w.text(`Działka ${p.number}, obręb ${p.precinct}`, { size: 14, bold: true, gap: 1 });
    w.pairs([
      ["Identyfikator", p.id],
      ["Gmina / powiat / województwo", `${p.commune} / ${p.county} / ${p.voivodeship}`],
      ["Powierzchnia (z geometrii)", `${num(p.areaHa, 2)} ha`],
      ["Punkt odczytu danych punktowych", `${num(p.labelPoint[1], 5)}° N, ${num(p.labelPoint[0], 5)}° E`]
    ]);
    const observations = request.observations?.[p.id];
    if (observations?.length) {
      w.text(`Obserwacje rolnika: ${observations.map(observation => FIELD_OBSERVATIONS[observation]).join(" · ")}.`, { size: 8.5, color: MUTED });
    }

    assessmentSection(w, result.assessment);

    const soil = env<SoilValue>("soil");
    const sections: [ModuleId, string, (e: DataEnvelope<never>) => void][] = [
      ["meteo", "1. Pogoda i bilans wodny", e => meteoSection(w, e as DataEnvelope<MeteoValue>, request.crop, soil?.value ?? null)],
      ["soil", "2. Gleba", e => soilSection(w, e as DataEnvelope<SoilValue>)],
      ["satellite", "3. Roślinność z satelity (Sentinel-2)", e => satelliteSection(w, e as DataEnvelope<SatelliteValue>)],
      ["terrain", "4. Ukształtowanie terenu", e => terrainSection(w, e as DataEnvelope<TerrainValue>)],
      ["hydro", "5. Wody i rowy melioracyjne", e => hydroSection(w, e as DataEnvelope<HydroValue>)],
      ["landcover", "6. Użytkowanie terenu", e => landcoverSection(w, e as DataEnvelope<LandCoverValue>)],
      ["drought", "7. Tło suszowe", () => undefined]
    ];
    for (const [id, title, render] of sections) {
      const e = env<never>(id);
      w.heading(title, e?.status ?? "missing");
      if (!e) {
        w.text(`${MODULE_LABELS[id]}: brak danych.`, { size: 8.5 });
        continue;
      }
      if (e.value !== null) render(e);
      w.notes(e);
    }
  });

  // Sources, deduplicated across parcels.
  w.newPage();
  w.text("Źródła danych i licencje", { size: 14, bold: true, gap: 2 });
  const seen = new Map<string, string[]>();
  for (const r of results) {
    for (const m of r.modules) {
      for (const s of m.sources) {
        const key = s.name;
        if (!seen.has(key)) {
          seen.set(key, [
            MODULE_LABELS[m.module],
            s.name,
            s.license,
            s.mode === "live" ? "na bieżąco" : "przygotowane wcześniej",
            new Date(m.fetchedAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }),
            s.url
          ]);
        }
      }
    }
  }
  w.table(["Moduł", "Źródło", "Licencja / warunki", "Tryb", "Pobrano", "Adres"], [...seen.values()], {
    styles: { font: FONT, fontSize: 7, cellPadding: 1.2, textColor: INK, lineColor: [200, 206, 202], lineWidth: 0.15 },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 42 }, 2: { cellWidth: 40 }, 3: { cellWidth: 17 }, 4: { cellWidth: 20 } }
  });
  w.text(
    `Literatura: ${KUS_2016.citation} (${KUS_2016.url}); Allen R.G., Pereira L.S., Raes D., Smith M. (1998), Crop evapotranspiration, FAO Irrigation and Drainage Paper 56.`,
    { size: 7.5, color: MUTED }
  );
  w.text(`Zalecane praktyki i koszty na podstawie „${RETENTION_GUIDE}”, s. 1–6.`, { size: 7.5, color: MUTED });

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont(FONT, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Zatrzymaj wodę · warunki wodne · dzień analizy ${day(request.date)}`, M, PAGE_H - M + 4);
    doc.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - M + 4, { align: "right" });
  }
  return doc;
}

/** Browser entry point: loads jsPDF and the fonts on demand, then saves the file. */
export async function downloadDataSummary(input: SummaryInput) {
  const [{ jsPDF }, { autoTable }, regular, bold] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    fetch("/fonts/AtkinsonHyperlegible-Regular.ttf").then(r => r.arrayBuffer()),
    fetch("/fonts/AtkinsonHyperlegible-Bold.ttf").then(r => r.arrayBuffer())
  ]);
  const doc = buildDataSummaryPdf(jsPDF, autoTable as AutoTable, input, { regular, bold });
  doc.save(`raport-warunki-wodne-${input.request.date}.pdf`);
}

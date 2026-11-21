# Zatrzymaj wodę

HackNation 2026, KOWR challenge "Zatrzymaj wodę, chroń plony". A web app for farmers: pick a
cadastral parcel, the crop and a day, and get an assessment of the parcel's water situation over
the last 10 years, the causes of any shortage, and data-backed retention, agrotechnical and
irrigation recommendations.

> Status: skeleton. Map, parcel search and selection, crop and date inputs, and the analysis API
> with the module contract work. The data modules are stubs that report "brak danych".

## Running

Requires Node 22+.

```sh
npm install        # also copies the MapLibre worker to public/maplibre
npm run dev        # http://localhost:3000
npm run typecheck
npm run build && npm start
```

No API keys are needed yet.

## How it works

```
Browser (Next.js page)                         Server (Next.js route handlers)
  map: GUGiK orthophoto + KIEG parcels (WMS)     GET  /api/places?q=<village | postcode>
  village / postcode search           ───────►        Photon (OSM), cached in memory
  pick a village → precinct outline   ───────►   GET  /api/precincts?lon=&lat=   (ULDK obręb)
  parcel search / click → selection   ───────►   GET  /api/parcels?q=… | ?lon=&lat=   (ULDK)
  crop + day → "Analizuj"             ───────►   POST /api/analyze {parcelIds, crop, date}
                                                      re-fetch parcels from ULDK
                                                      run data modules in parallel → envelopes
```

A thin backend is deliberate:
- Open-Meteo rate-limits per IP, and the event venue shares one.
- GUGiK NMT WCS sends no CORS headers.
- Copernicus needs an OAuth secret.
- Caching makes repeat jury runs fast.

### The module contract

Each data source is a module in [lib/analysis/modules/](lib/analysis/modules/) that returns a
`DataEnvelope` ([lib/analysis/contract.ts](lib/analysis/contract.ts)) with `status`
(`ok | partial | missing | error`), `value`, `sources` (name, URL, licence, live or prepared),
`fetchedAt`, `period`, `uncertainty` and plain-Polish `notes`. The report's sources, limitations
and "brak danych" sections are generated from these envelopes. A module that throws or exceeds
20 s becomes an `error` envelope, and the analysis still completes.

All modules receive the analysis day `asOf` and must not use data after it. The jury tests
historical days within the last 10 years.

| Module | File | Planned source |
|---|---|---|
| Parcel | `parcel.ts` | GUGiK ULDK (working) |
| Meteo | `meteo.ts` | Open-Meteo ERA5 / IMGW: P, T, ET0 FAO-56, climatic water balance |
| Soil | `soil.ts` | SoilGrids, IUNG soil drought categories |
| Satellite | `satellite.ts` | Copernicus Data Space Statistical API: NDVI/NDMI anomalies |
| Terrain | `terrain.ts` | GUGiK NMT WCS: slope, depressions |
| Hydro | `hydro.ts` | MPHP / BDOT10k: watercourses, ditches |
| Drought | `drought.ts` | EDO CDI / soil moisture anomaly |

### Structure

```
app/                 page, layout, styles, API routes (api/parcels, api/analyze)
components/          map, search, selected parcels, app container
lib/parcels/         ULDK client and parcel types
lib/analysis/        module contract, runner, modules
lib/crops.ts         crop groups (mirror IUNG drought monitoring)
lib/dates.ts         analysis-day rules (today − 10 years … today, Europe/Warsaw)
```

Village search: Photon matches names (prefixes, missing diacritics) among cities, towns,
villages and hamlets in Poland. A full postcode (`88-150`, `88150`) finds the postcode area,
then lists the places inside it, keeping those tagged with that postcode plus untagged ones
inside the area, sorted alphabetically (up to 50). Picking a place zooms to it and outlines
its cadastral precinct (obręb) for 12 s. In the countryside that is usually the village;
larger towns are split into several precincts.

The page state is mirrored in the URL (`?dzialki=<id>,<id>&uprawa=<crop>&data=<YYYY-MM-DD>`),
so a selection can be shared or reopened as a link.

## Data sources (so far)

| Data | Source | Mode | Terms |
|---|---|---|---|
| Parcel geometry, ids | [GUGiK ULDK](https://uldk.gugik.gov.pl/) | live | Public data, free of charge |
| Orthophoto | [GUGiK ORTO WMS](https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution) | live | Public data, free of charge |
| Parcel boundaries layer | [GUGiK KIEG WMS](https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow) | live | Public data, free of charge |

KIEG only draws at scales of about 1:5000 or larger (zoom 16+). For zooms 13–15 the map lowers MapServer's `MAP_RESOLUTION` per tile (`kiegTransform` in [components/parcel-map.tsx](components/parcel-map.tsx)), so the service still draws 1-px lines; parcel numbers stay at zoom 16+.
| Place names | [OpenFreeMap](https://openfreemap.org/) / OpenStreetMap | live | ODbL (data), free service |
| Village / postcode search | [Photon](https://photon.komoot.io/) (komoot), OpenStreetMap data | live | ODbL (data); public API, fair use |
| Precinct (obręb) outlines | [GUGiK ULDK](https://uldk.gugik.gov.pl/) `GetRegionByXY` | live | Public data, free of charge |

## Libraries

Next.js, React (MIT); MapLibre GL JS (BSD-3-Clause); Turf (MIT); @terraformer/wkt (MIT);
Atkinson Hyperlegible Next/Mono fonts (SIL OFL 1.1).

## To do for submission (task §4.2)

- [ ] Features: assessment, causes, retention, agrotechnics, irrigation
- [ ] Data sources with ranges, and which data is live vs prepared (with dates)
- [ ] AI tools used and how
- [ ] Licences of data and components (complete the tables above)
- [ ] Known limitations
- [ ] How results and recommendations are verified
- [ ] Scaling: caching, rate limits, update schedule, costs

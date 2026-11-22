# Zatrzymaj wodę

HackNation 2026, KOWR challenge "Zatrzymaj wodę, chroń plony". A web app for farmers: pick a
cadastral parcel, the crop and a day, and get an assessment of the parcel's water situation over
the last 10 years, the causes of any shortage, and data-backed retention, agrotechnical and
irrigation recommendations.

"Analizuj" fetches weather, soil, satellite, terrain, hydrology and land-cover data for each
parcel, then shows a 1–5 water-condition score and applicable retention and agrotechnical
measures. The downloadable PDF starts with the scores for all selected parcels and includes
the supporting data. Both views show the seasonal water-deficit profile for each parcel.

## Running

Requires Node 22.13+ (BDOT10k GeoPackages are read with the built-in `node:sqlite`).

```sh
npm install        # also copies the MapLibre worker to public/maplibre
npm run dev        # http://localhost:3000
npm run typecheck
npm test           # scoring and recommendation rules
npm run build && npm start
```

No API keys are needed. Optional settings go in `.env.local` (see [.env.example](.env.example)):

- `OPEN_METEO_PROXY`: forwarder for Open-Meteo calls, normally the Cloudflare Worker below:
  `https://<worker>.workers.dev/<PROXY_KEY>`.
- `UPSTREAM_PROXY`: forwarder for every other upstream service (GUGiK ULDK and WMS tiles,
  SoilGrids, BDOT10k, NASA POWER, Photon, Copernicus DEM). Planetary Computer always goes direct.
- `DATA_CACHE_DIR`: where fetched data is cached (default `./.cache`, gitignored).

Both proxies take the target URL appended (`<proxy>/https://uldk.gugik.gov.pl/?…`). When a
proxy is set, its services go through it; when nothing is set, the app calls the services
directly ([lib/server/http.ts](lib/server/http.ts)). Use them on networks where public APIs
throttle a shared IP, such as a hackathon venue.

### Open-Meteo Worker

Open-Meteo's free API limits requests per IP per day, and a 10-year request counts as about
270 of them. [workers/open-meteo-proxy](workers/open-meteo-proxy/) is a Cloudflare Worker that
forwards GET requests to Open-Meteo hosts only, requires a secret key in the path, and caches
responses at Cloudflare's edge (past ranges for a day). Deploy with your Cloudflare account:

```sh
cd workers/open-meteo-proxy
npx wrangler deploy
npx wrangler secret put PROXY_KEY     # a long random string
# .env.local: OPEN_METEO_PROXY=https://zatrzymaj-wode-open-meteo.<account>.workers.dev/<PROXY_KEY>
```

For the hackathon jury the repository ships a committed [.env](.env) that points
`OPEN_METEO_PROXY` at our deployed Worker, so the app works without setup. That key stops
working on 15.12.2026 (`EXPIRES_AT` in [wrangler.toml](workers/open-meteo-proxy/wrangler.toml));
after that the Worker answers 410 and the app falls back to NASA POWER. The same file sets
`UPSTREAM_PROXY` to a disposable hackathon proxy, because GUGiK throttles the shared venue IP;
remove that line after the event to call the services directly.

The app also requests ERA5 one calendar year at a time, so finished years are cached for a
year on disk and in the Worker, and other analysis days for the same grid cell reuse them.

## How it works

```
Browser (Next.js page)                         Server (Next.js route handlers)
  map: GUGiK orthophoto + KIEG parcels ──────►   GET  /api/wms/{orto|kieg}?<GetMap>  (WMS tiles)
                                                 GET  /api/places?q=<village | postcode>
  village / postcode search           ───────►        Photon (OSM), cached in memory
  pick a village → precinct outline   ───────►   GET  /api/precincts?lon=&lat=   (ULDK obręb)
  parcel search / click → selection   ───────►   GET  /api/parcels?q=… | ?lon=&lat=   (ULDK)
  crop + day → "Analizuj"             ───────►   POST /api/analyze {parcelIds, crop, date}
                                                      re-fetch parcels from ULDK
                                                      run data modules in parallel → envelopes
                                                      assess water conditions and select measures
  "Pobierz raport (PDF)"       ◄── results        PDF built in the browser (jsPDF), no re-run
```

A thin backend is deliberate:
- Open-Meteo and GUGiK rate-limit per IP, and the event venue (2000 people) shares one; server
  calls, map tiles included, can go through a proxy, browser calls could not.
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

| Module | File | Source | What it returns |
|---|---|---|---|
| Parcel | `parcel.ts` | GUGiK ULDK | id, location, area |
| Meteo | `meteo.ts` | Open-Meteo ERA5 (fallback: NASA POWER with our own FAO-56 ET0) | P, ET0, P−ET0 for 30/60/90 days; the same 60 days in each of the past 10 years, with rank; Apr–Sep seasons; monthly P vs crop optimum (Kuś 2016, tab. 3) |
| Soil | `soil.ts` | ISRIC SoilGrids WCS | sand/silt/clay, SOC, pH 0–30 cm; USDA texture; water at pF 2.5 / 4.2 to 1 m and available water; comparison with Kuś 2016, tab. 4 |
| Satellite | `satellite.ts` | Sentinel-2 L2A via Microsoft Planetary Computer | median NDVI/NDMI over the parcel in the 30 days before the analysis day and in the same window of each of the past 10 years (SCL cloud check) |
| Terrain | `terrain.ts` | Copernicus DEM GLO-30 | elevation, slope, share above 5 %, position vs 500 m surroundings, drainage direction, lowest point |
| Hydro | `hydro.ts` | GUGiK BDOT10k | nearest ditch / watercourse / canal / water body; lengths and counts within 100 and 500 m |
| Land cover | `landcover.ts` | GUGiK BDOT10k | land-cover shares on the parcel and in a 500 m ring |
| Drought | `drought.ts` | (EDO CDI, not built) | "brak danych" |

For each calendar month, the seasonal profile compares the ten full calendar years before
the selected analysis year. It reports the median of monthly P−ET0 and how many years had
a negative monthly balance among years with complete daily observations for that month.

Fetched data is cached on disk (`.cache/`), so a repeat run for the same parcel and day makes no
upstream calls. A cold run takes about 3–8 s per parcel.

### Water-condition score and retention recommendations

The score is a screening heuristic on the selected date. It uses the last complete 30 days
of precipitation minus reference evapotranspiration (P−ET₀). The weather window must end
within seven days of the analysis date. The absolute negative balance, in mm, gives the
base score below. A positive balance has zero climatic deficit for the purposes of the score.
Light and very light soils hold less water, so they use lower thresholds.

| Climatic deficit (mm) | Score 5 | Score 4 | Score 3 | Score 2 | Score 1 |
|---|---:|---:|---:|---:|---:|
| Other soils | <15 | 15 to <35 | 35 to <60 | 60 to <90 | ≥90 |
| Light or very light soil | <10 | 10 to <25 | 25 to <45 | 45 to <65 | ≥65 |

A fixed deficit means more in April than in a typical July, so the season adjusts the base score
when at least six years are available. The current 60-day balance is ranked among the same 60-day
window in earlier years. If it is among the driest 20 % and negative, the score drops one point.
If it is wetter than 60 % of the years, the score rises one point.

The score describes water shortage only. Farmer-reported persistent ponding is shown separately
as `Nadmiar wody` and leaves the score unchanged. On annual crops it suggests checking for a compacted
layer, and on grassland the report adds the payment for retention on permanent grassland.
Observations are attached to individual parcels on the selected date; changing the date clears
them and says so. Missing or stale weather data yields `Brak oceny`. The score includes an
uncertainty label, and the report provides the 60-day balance, earlier 60-day windows and
usable Sentinel-2 observations where available. The thresholds are prototype settings and
need calibration against field measurements of root-zone moisture and waterlogging.
The score uses reference evapotranspiration. Estimating crop-specific water use and irrigation
amounts requires a crop water balance. [FAO-56, chapter 5](https://www.fao.org/4/X0490E/x0490e0a.htm)

The rule set picks up to three of the ten practices from *Retencja wody na polach uprawnych*
(22 November 2026, [public/poradnik-retencja-wody.pdf](public/poradnik-retencja-wody.pdf)) using
the assessment, crop type, parcel data and optional farmer observations. Each recommendation
provides the evidence, a check or next step, the guide's indicative cost before subsidies with
its original unit (pp. 2–5), and the matching subsidy where the guide lists one (p. 6). The app
links each page reference to the guide. Map features can suggest places to inspect. Controlled
drainage and ponds require field checks before any investment.

The scoring and recommendation rules have unit tests in
[lib/analysis/water-assessment.test.ts](lib/analysis/water-assessment.test.ts), run with
`npm test` (Node's built-in test runner, no extra dependencies).

### Structure

```
app/                 page, layout, styles, API routes (api/parcels, api/analyze)
components/          map, search, selected parcels, water results, PDF report
lib/parcels/         ULDK client and parcel types
lib/analysis/        module contract, runner, modules, value types (values.ts)
lib/meteo/           Open-Meteo and NASA POWER clients, FAO-56 ET0, statistics
lib/soil/            SoilGrids WCS reader, USDA texture classes
lib/satellite/       Planetary Computer STAC search and zonal statistics
lib/bdot10k/         per-layer download from county zips (HTTP Range), GeoPackage reader
lib/geo/             planar geometry helpers, EPSG:2180 projection
lib/reference/       reference tables from the literature (Kuś 2016)
lib/server/          caches (memory, disk), fetch helpers
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

## Data sources

All data is fetched live when a parcel is analysed, then cached on disk. Nothing is prepared in
advance yet.

| Data | Source | Mode | Terms |
|---|---|---|---|
| Parcel geometry, ids | [GUGiK ULDK](https://uldk.gugik.gov.pl/) | live | Public data, free of charge |
| Orthophoto | [GUGiK ORTO WMS](https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution) | live | Public data, free of charge |
| Parcel boundaries layer | [GUGiK KIEG WMS](https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow) | live | Public data, free of charge |
| Place names | [OpenFreeMap](https://openfreemap.org/) / OpenStreetMap | live | ODbL (data), free service |
| Village / postcode search | [Photon](https://photon.komoot.io/) (komoot), OpenStreetMap data | live | ODbL (data); public API, fair use |
| Precinct (obręb) outlines | [GUGiK ULDK](https://uldk.gugik.gov.pl/) `GetRegionByXY` | live | Public data, free of charge |
| Precipitation, temperature, ET0 | [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), ERA5 / ERA5-Land (`era5_seamless`); last days from the [forecast API](https://open-meteo.com/en/docs) | live, via the Cloudflare Worker when `OPEN_METEO_PROXY` is set | Data CC BY 4.0; free API for non-commercial use |
| Weather fallback | [NASA POWER daily API](https://power.larc.nasa.gov/docs/services/api/) (MERRA-2, CERES), about 0.5° | live | NASA data, no restrictions; cite the source |
| Soil texture, SOC, pH, water retention | [ISRIC SoilGrids 2.0](https://docs.isric.org/globaldata/soilgrids/) via WCS, 250 m | live | CC BY 4.0 |
| Sentinel-2 L2A NDVI / NDMI | [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a) STAC and data API (zonal statistics) | live | Copernicus Sentinel data licence (free); Planetary Computer Terms of Use |
| Elevation | [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) (AWS Open Data, COG) | live | Copernicus DEM GLO-30 licence: free with attribution |
| Ditches, watercourses, water bodies, land cover | [GUGiK BDOT10k](https://www.geoportal.gov.pl/pl/dane/baza-danych-obiektow-topograficznych-bdot10k/) county GeoPackages from opendata.geoportal.gov.pl (only the needed layers, via HTTP Range) | live, cached 60 days | Public data, free of charge |

KIEG only draws at scales of about 1:5000 or larger (zoom 16+). For zooms 13–15 the map lowers MapServer's `MAP_RESOLUTION` per tile (`kiegTransform` in [components/parcel-map.tsx](components/parcel-map.tsx)), so the service still draws 1-px lines; parcel numbers stay at zoom 16+.

Reference values and methods:
- Kuś J. (2016), *Gospodarowanie wodą w rolnictwie*, Studia i Raporty IUNG-PIB 47(1): 83–104,
  [iung.pl/sir/zeszyt47_5.pdf](https://iung.pl/sir/zeszyt47_5.pdf): optimal monthly precipitation
  per crop (tab. 3, after Dzieżyc 1989) and water reserves by soil category (tab. 4).
- Allen et al. (1998), FAO-56: Penman–Monteith ET0, computed in
  [lib/meteo/et0.ts](lib/meteo/et0.ts) for the NASA POWER fallback.
- Steduto et al. (2012), FAO Irrigation and Drainage Paper 66, *Crop yield response to water*:
  for the assessment step (sensitive crop stages, yield response to water deficit).

## Known limitations

- Open-Meteo's free API limits requests per IP per day. On 21.11.2026 the venue IP was blocked
  (HTTP 429); through the Cloudflare Worker the same requests succeed. If Open-Meteo still fails,
  the meteo module falls back to NASA POWER (coarser, about 50 km) and says so in the report.
- GUGiK throttles busy IPs: ULDK, KIEG tiles and the NMT point service then redirect to
  `integracja01.gugik.gov.pl/resp/…`. Without `UPSTREAM_PROXY` the app reports this as
  "ULDK nie odpowiada" rather than "no parcel here".
- Planetary Computer is always called directly; if it throttles, satellite data for that run
  is partial or missing, and the report says so.
- GUGiK NMT WCS (1 m terrain) returned capabilities but no coverage within 60 s in tests, so
  terrain uses the 30 m Copernicus DEM, a surface model (includes buildings and tree crowns).
- SoilGrids is a 250 m global model; its water retention looks high for sandy soils compared
  with Kuś (2016), tab. 4. The soil category is an approximation from the USDA texture class.
- BDOT10k and parcel boundaries are current versions, also for historical analysis days.
- The drought background (EDO CDI) is not fetched yet.

## Libraries

Next.js, React (MIT); MapLibre GL JS (BSD-3-Clause); Turf (MIT); @terraformer/wkt (MIT);
geotiff.js (MIT); proj4js (MIT); jsPDF and jspdf-autotable (MIT); Atkinson Hyperlegible
Next/Mono fonts (SIL OFL 1.1); Atkinson Hyperlegible TTF files in `public/fonts/` for the PDF
(SIL OFL 1.1, licence in [public/fonts/OFL.txt](public/fonts/OFL.txt)).

Services: Cloudflare Workers (free plan) hosts the optional Open-Meteo forwarder.

## To do for submission (task §4.2)

- [x] Water-condition assessment, causes, retention and agrotechnics
- [ ] Optional crop-specific irrigation guidance
- [x] Data sources, and which data is live vs prepared (all live so far)
- [ ] AI tools used and how
- [ ] Licences of data and components (complete the tables above)
- [x] Known limitations (data layer)
- [ ] How results and recommendations are verified
- [ ] Scaling: caching, rate limits, update schedule, costs

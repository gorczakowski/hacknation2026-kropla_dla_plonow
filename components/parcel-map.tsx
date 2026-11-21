"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, LayerSpecification, Map as MlMap, StyleSpecification } from "maplibre-gl";
import type { ParcelFeature, PrecinctFeature } from "@/lib/parcels/types";

export type MapFocus = { bbox: [number, number, number, number]; seq: number; maxZoom?: number };

type Props = {
  parcels: ParcelFeature[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  /** Click on an empty spot (not on a selected parcel). */
  onPickAt: (lon: number, lat: number) => void;
  /** Click on a parcel that is already selected. */
  onPickSelected: (id: string) => void;
  focus: MapFocus | null;
  /** Temporary outline of a precinct (village) after a place search. */
  area: PrecinctFeature | null;
  /** Short status line shown over the map (loading, errors). */
  message: string | null;
};

const POLAND: [number, number, number, number] = [14.07, 49.0, 24.15, 54.84];
/** Parcel lines from this zoom; see kiegTransform for how KIEG is made to draw them. */
const PARCELS_MIN_ZOOM = 13;
/** Below this, a click is too imprecise to mean one parcel. */
const PICK_MIN_ZOOM = 13;

const RAPESEED = "#F2C21B";
const AREA_FADE_MS = 800;
const INK = "#1F2A24";

/**
 * GUGiK WMS tiles come through our /api/wms route, so they use UPSTREAM_PROXY
 * when it is set (GUGiK throttles shared venue IPs). Absolute URLs, because
 * MapLibre fetches tiles from its worker.
 */
const ORIGIN = typeof window === "undefined" ? "" : window.location.origin;
const ORTO_URL = `${ORIGIN}/api/wms/orto`;
const KIEG_URL = `${ORIGIN}/api/wms/kieg`;
/** KIEG (MapServer) draws nothing at scales smaller than about 1:5000; stay safely under. */
const KIEG_MAX_SCALE = 4200;

/**
 * KIEG computes the map scale from the requested metres per pixel and an assumed
 * screen resolution (72 dpi), and returns an empty image above ~1:5000, which is
 * zoom 16. Lowering MAP_RESOLUTION (a MapServer parameter) for larger tiles makes
 * it draw at zooms 13–15 as well, still as crisp 1-px lines in a 512-px tile.
 */
function kiegTransform(url: string) {
  if (!url.startsWith(KIEG_URL)) return undefined;
  const bbox = new URL(url).searchParams.get("BBOX")?.split(",").map(Number);
  if (!bbox || bbox.length !== 4) return undefined;
  const metresPerPixel = (bbox[2] - bbox[0]) / 512;
  const dpi = Math.floor((0.0254 * KIEG_MAX_SCALE) / metresPerPixel);
  return dpi < 72 ? { url: `${url}&MAP_RESOLUTION=${Math.max(dpi, 1)}` } : undefined;
}

const wms = (base: string, params: string) =>
  `${base}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&${params}`;

/** Town and village names from OpenStreetMap, so the farmer can find their place on the photo. */
function placeLayer(
  id: string,
  classes: string[],
  minzoom: number,
  [z1, size1, z2, size2]: [number, number, number, number]
): LayerSpecification {
  return {
    id,
    type: "symbol",
    source: "ofm",
    "source-layer": "place",
    minzoom,
    filter: ["in", ["get", "class"], ["literal", classes]],
    layout: {
      "text-field": ["coalesce", ["get", "name:pl"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], z1, size1, z2, size2]
    },
    paint: {
      "text-color": "#FFFFFF",
      "text-halo-color": "rgba(24, 32, 27, 0.9)",
      "text-halo-width": 1.6
    }
  };
}

const STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    orto: {
      type: "raster",
      tiles: [
        wms(ORTO_URL, "LAYERS=Raster&FORMAT=image/jpeg")
      ],
      tileSize: 512,
      maxzoom: 19,
      attribution: "Ortofotomapa © GUGiK"
    },
    kieg: {
      type: "raster",
      tiles: [
        wms(KIEG_URL, "LAYERS=dzialki,numery_dzialek&FORMAT=image/png&TRANSPARENT=TRUE")
      ],
      tileSize: 512,
      minzoom: PARCELS_MIN_ZOOM,
      maxzoom: 19,
      attribution: "Ewidencja gruntów © GUGiK (KIEG)"
    },
    ofm: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution: "© OpenStreetMap, OpenFreeMap"
    },
    area: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    },
    selected: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      promoteId: "id"
    },
    // One label point per parcel (polygon labels would repeat on every tile).
    "selected-labels": {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    }
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#26302A" } },
    { id: "orto", type: "raster", source: "orto" },
    {
      id: "kieg",
      type: "raster",
      source: "kieg",
      // Turn GUGiK's thin blue lines near-white so they read on the orthophoto;
      // softer when zoomed out, where village plots get dense.
      paint: {
        "raster-saturation": -1,
        "raster-brightness-min": 0.88,
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.55, 15, 0.8, 16, 0.9]
      }
    },
    {
      id: "area-fill",
      type: "fill",
      source: "area",
      paint: { "fill-color": "#FFFFFF", "fill-opacity": 0.1, "fill-opacity-transition": { duration: AREA_FADE_MS } }
    },
    {
      id: "area-casing",
      type: "line",
      source: "area",
      paint: {
        "line-color": INK,
        "line-width": 6,
        "line-opacity": 0.5,
        "line-opacity-transition": { duration: AREA_FADE_MS }
      }
    },
    {
      id: "area-line",
      type: "line",
      source: "area",
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#FFFFFF",
        "line-width": 2.5,
        "line-dasharray": [3, 2],
        "line-opacity-transition": { duration: AREA_FADE_MS }
      }
    },
    placeLayer("places-minor", ["village", "hamlet"], 11, [11, 12, 16, 16]),
    placeLayer("places-major", ["city", "town"], 5, [6, 12, 14, 19]),
    {
      id: "selected-fill",
      type: "fill",
      source: "selected",
      paint: {
        "fill-color": RAPESEED,
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.4, 0.16]
      }
    },
    {
      id: "selected-casing",
      type: "line",
      source: "selected",
      paint: { "line-color": INK, "line-width": 5.5, "line-opacity": 0.55 }
    },
    {
      id: "selected-line",
      type: "line",
      source: "selected",
      paint: {
        "line-color": RAPESEED,
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4, 2.75]
      }
    },
    {
      id: "selected-label",
      type: "symbol",
      source: "selected-labels",
      minzoom: 13,
      layout: {
        "text-field": ["get", "number"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 15,
        "text-allow-overlap": true
      },
      paint: { "text-color": INK, "text-halo-color": RAPESEED, "text-halo-width": 3 }
    }
  ]
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ParcelMap({ parcels, highlightedId, onHighlight, onPickAt, onPickSelected, focus, area, message }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(6);

  // Latest callbacks for map event handlers registered once.
  const handlers = useRef({ onHighlight, onPickAt, onPickSelected });
  handlers.current = { onHighlight, onPickAt, onPickSelected };

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;

    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      maplibre.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);

      map = new maplibre.Map({
        container: containerRef.current,
        style: STYLE,
        bounds: POLAND,
        fitBoundsOptions: { padding: 24 },
        maxBounds: [
          [10.5, 47.5],
          [27.5, 56.5]
        ],
        maxZoom: 19,
        attributionControl: { compact: true },
        transformRequest: kiegTransform,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
        "top-right"
      );
      map.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");

      const updateZoom = () => setZoom(map!.getZoom());
      map.on("zoomend", updateZoom);

      let hovered: string | null = null;
      map.on("mousemove", "selected-fill", e => {
        const id = e.features?.[0]?.id;
        if (typeof id === "string" && id !== hovered) {
          hovered = id;
          handlers.current.onHighlight(id);
        }
      });
      map.on("mouseleave", "selected-fill", () => {
        hovered = null;
        handlers.current.onHighlight(null);
      });

      map.on("click", e => {
        const hit = map!.queryRenderedFeatures(e.point, { layers: ["selected-fill"] })[0];
        if (typeof hit?.id === "string") {
          handlers.current.onPickSelected(hit.id);
          return;
        }
        if (map!.getZoom() < PICK_MIN_ZOOM) {
          map!.easeTo({ center: e.lngLat, zoom: Math.min(map!.getZoom() + 3, PICK_MIN_ZOOM + 1), duration: prefersReducedMotion() ? 0 : 600 });
          return;
        }
        handlers.current.onPickAt(e.lngLat.lng, e.lngLat.lat);
      });

      // Compact attribution opens itself on narrow screens; fold it once the map has
      // settled so it does not cover half of a phone screen. It stays one tap away.
      map.once("idle", () =>
        containerRef.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show")
      );

      map.once("style.load", () => {
        if (cancelled) return;
        mapRef.current = map;
        updateZoom();
        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Selected parcels → GeoJSON source.
  useEffect(() => {
    const map = mapRef.current;
    map?.getSource<GeoJSONSource>("selected")?.setData({ type: "FeatureCollection", features: parcels });
    map?.getSource<GeoJSONSource>("selected-labels")?.setData({
      type: "FeatureCollection",
      features: parcels.map(p => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: p.properties.labelPoint },
        properties: { number: p.properties.number }
      }))
    });
  }, [parcels, ready]);

  // Highlight (from list hover or map hover).
  const lastHighlight = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lastHighlight.current) map.setFeatureState({ source: "selected", id: lastHighlight.current }, { hover: false });
    if (highlightedId) map.setFeatureState({ source: "selected", id: highlightedId }, { hover: true });
    lastHighlight.current = highlightedId;
  }, [highlightedId, parcels, ready]);

  // Fly to a parcel when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const [w, s, e, n] = focus.bbox;
    map.fitBounds(
      [
        [w, s],
        [e, n]
      ],
      { padding: 64, maxZoom: focus.maxZoom ?? 17, duration: prefersReducedMotion() ? 0 : 900 }
    );
  }, [focus, ready]);

  // Precinct outline: shown at once, faded out when cleared.
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource<GeoJSONSource>("area");
    if (!map || !source) return;
    const opacity = (fill: number, casing: number, line: number) => {
      map.setPaintProperty("area-fill", "fill-opacity", fill);
      map.setPaintProperty("area-casing", "line-opacity", casing);
      map.setPaintProperty("area-line", "line-opacity", line);
    };
    if (area) {
      source.setData(area);
      opacity(0.1, 0.5, 1);
      return;
    }
    opacity(0, 0, 0);
    const timer = setTimeout(() => source.setData({ type: "FeatureCollection", features: [] }), AREA_FADE_MS);
    return () => clearTimeout(timer);
  }, [area, ready]);

  const hint =
    zoom < Math.max(PICK_MIN_ZOOM, PARCELS_MIN_ZOOM)
      ? "Wyszukaj swoją miejscowość albo przybliż mapę, żeby zobaczyć granice działek."
      : "Kliknij działkę, żeby ją dodać. Kliknij ponownie, żeby ją usunąć.";

  return (
    <div className="map">
      <div ref={containerRef} className="map__canvas" data-pickable={zoom >= PICK_MIN_ZOOM} />
      <p className="map__hint" role="status" aria-live="polite" data-tone={message ? "message" : "hint"}>
        {message ?? hint}
      </p>
    </div>
  );
}

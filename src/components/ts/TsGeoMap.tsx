import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MAPBOX_TOKEN } from "../../data/prospectPlace";
import { TS_HUES } from "../../data/tsPalette";
import { tsNum } from "./tsChart";

/* =============================================================================
   TsGeoMap — the "Geo Heatmap" template.
   -----------------------------------------------------------------------------
   ⚠️ THE REAL TILE IS OPENLAYERS, NOT MAPBOX GL, and this is Leaflet. Read off the
   capture: `ol-viewport`, `ol-layer`, `ol-zoom`, `ol-zoom-in` — OpenLayers, drawing
   Mapbox RASTER TILES (hence the "© Mapbox © OpenStreetMap / Improve this map"
   attribution). Mapbox supplies the tiles; it is not the map library.

   Leaflet was chosen deliberately over matching them exactly. The app ships as ONE
   1.86MB bundle with NO code splitting — a property the service worker depends on —
   so every library lands on every screen. Leaflet is ~42KB gzipped against
   OpenLayers' ~120-180KB even tree-shaken, and with the same Mapbox tiles underneath
   the two are visually indistinguishable. Agreed with the user 2026-08-21.

   ⚠️ THE DOT COLOUR IS READ FROM A SCREENSHOT, NOT MEASURED. OpenLayers draws its
   vector layer to a CANVAS, so there is no DOM node carrying a fill to read — unlike
   every other template in this layer. The reference dots are a rose red that darkens
   where they overlap, which is what the palette's red at partial opacity does.
   ============================================================================= */

/** A point on the map: where, how big, and what the number is. */
export interface TsGeoPoint {
  lat: number;
  lon: number;
  value: number;
  /** Optional place name, shown above the coordinates when present. */
  label?: string;
}

const DOT = TS_HUES.red[2];               // #E4131B
const DOT_OPACITY = 0.7;                  // overlapping dots darken, as the reference shows
/* ⚠️ SMALLER THAN THE FIRST PASS (was 4–13), asked for 2026-08-21. At 4–13 a big metro
   read as a blob rather than a cluster, and adjacent dots merged into one shape — the
   reference keeps them individually distinguishable even where they overlap. */
const DOT_MIN = 2.5;
const DOT_MAX = 8;

/* Mapbox's own light style, the same tiles the reference uses. `@2x` because the
   captured canvas carried a 1.111 device-pixel transform — the real tile serves
   retina raster. */
const TILE_URL =
  `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN ?? ""}`;

export function TsGeoMap({
  points, valueLabel = "Total Call Count", coordLabel = "Best Location Latitude, Best Location Longitude",
  onSelect,
}: {
  points: TsGeoPoint[];
  /** Second tooltip row's caption — the measure being mapped. */
  valueLabel?: string;
  /** First tooltip row's caption. The reference names both coordinate columns. */
  coordLabel?: string;
  onSelect?: (label: string, value: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; p: TsGeoPoint } | null>(null);
  /** Re-runnable fit, so the resize observer can re-apply it once the size is real. */
  const fitRef = useRef<(() => void) | null>(null);

  const clean = useMemo(
    () => points.filter((p) => isFinite(p.lat) && isFinite(p.lon) && p.value > 0),
    [points],
  );
  const max = useMemo(() => Math.max(1, ...clean.map((p) => p.value)), [clean]);

  /* Build the map once. Leaflet owns its own DOM, so React must not re-render into it. */
  useEffect(() => {
    if (!host.current || mapRef.current) return;
    const map = L.map(host.current, {
      /* Leaflet's default zoom control is a rounded pair top-left; the reference is a
         square dark pair in the same corner, so the position is kept and the look comes
         from CSS (.ts-geo .leaflet-control-zoom). */
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,     // a demo page must not hijack the page scroll
      worldCopyJump: true,        // panning past the antimeridian stays sane
    });
    L.tileLayer(TILE_URL, {
      maxZoom: 18,
      tileSize: 512,
      zoomOffset: -1,
      attribution:
        '© <a href="https://www.mapbox.com/about/maps">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  /* Draw the dots, and fit the view to them. */
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    for (const pt of clean) {
      /* Area, not radius, tracks the value — a radius-linear dot exaggerates a big
         number into a blob four times the area it should be. */
      const t = Math.sqrt(pt.value / max);
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: DOT_MIN + t * (DOT_MAX - DOT_MIN),
        stroke: false,
        fillColor: DOT,
        fillOpacity: DOT_OPACITY,
        /* Leaflet keeps interactive vectors above the tiles for us. */
        interactive: true,
      });
      marker.on("mouseover", (e) => {
        const cp = map.latLngToContainerPoint(e.latlng);
        setHover({ x: cp.x, y: cp.y, p: pt });
        marker.setStyle({ stroke: true, color: "#1d232f", weight: 2, fillOpacity: 0.9 });
      });
      marker.on("mouseout", () => {
        setHover(null);
        marker.setStyle({ stroke: false, fillOpacity: DOT_OPACITY });
      });
      if (onSelect) marker.on("click", () => onSelect(pt.label ?? `${pt.lat}, ${pt.lon}`, pt.value));
      marker.addTo(layer);
    }

    /* ⚠️ "START CENTRED ON ALL THE DOTS" IS `fitBounds`, NOT A HARD-CODED CENTRE. A
       prospect's calls are wherever their customers are, and a fixed US centre would
       cut off anyone regional. `padding` keeps the outermost dot off the edge. */
    fitRef.current = () => {
      if (!clean.length) { map.setView([39.5, -98.35], 3); return; }
      map.fitBounds(L.latLngBounds(clean.map((p) => [p.lat, p.lon] as [number, number])), {
        padding: [28, 28], maxZoom: 9, animate: false,
      });
    };
    fitRef.current();
  }, [clean, max, onSelect]);

  /* ⚠️ FIT AFTER THE CONTAINER HAS A REAL SIZE, NOT BEFORE. Inside a flex tile the map
     div is 0x0 on the first paint, so an immediate `fitBounds` computes against nothing
     and lands on a wrong zoom — observed: the view kept Alaska off-screen even though its
     dot was inside the bounds. `invalidateSize` alone does NOT re-fit, it only re-measures,
     so the fit has to be re-run once the size is known. A ResizeObserver also handles the
     window being resized mid-demo, which the one-shot version did not. */
  useEffect(() => {
    const el = host.current;
    const map = mapRef.current;
    if (!el || !map) return;
    let lastW = 0, lastH = 0;
    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w < 2 || h < 2 || (w === lastW && h === lastH)) return;
      lastW = w; lastH = h;
      map.invalidateSize({ animate: false });
      fitRef.current?.();
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clean]);

  /* Clear the hover panel when the view moves under the pointer. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const clear = () => setHover(null);
    map.on("movestart zoomstart", clear);
    return () => { map.off("movestart zoomstart", clear); };
  }, []);

  return (
    <div className="ts-geo">
      <div className="ts-geo-map" ref={host} />
      {hover ? (
        /* Same dark panel as every other tooltip in this layer, positioned in container
           pixels because Leaflet gives us container coordinates, not percentages. */
        <div className="ts-tip ts-geo-tip"
          style={{ left: hover.x, top: hover.y, transform: "translate(-50%, calc(-100% - 14px))" }}>
          <div className="ts-tip-k">{coordLabel}</div>
          <div className="ts-tip-v">{hover.p.lat.toFixed(4)}, {hover.p.lon.toFixed(4)}</div>
          <div className="ts-tip-k ts-tip-gap">{valueLabel}</div>
          <div className="ts-tip-v">{tsNum(hover.p.value)}</div>
        </div>
      ) : null}
      {!MAPBOX_TOKEN ? (
        /* Stated plainly rather than rendering a blank grey box: without the token the
           tiles cannot load, and the dots alone would look like a bug. */
        <div className="ts-geo-notoken">
          Set <code>VITE_MAPBOX_TOKEN</code> to load map tiles.
        </div>
      ) : null}
    </div>
  );
}

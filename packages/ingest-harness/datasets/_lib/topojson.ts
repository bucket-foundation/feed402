// Minimal TopoJSON → polygon decoder + point-in-polygon test. Zero deps.
// Uses Natural Earth 1:110m via world-atlas@2 (CC-BY) — 108KB committed asset.
// Spec: https://github.com/topojson/topojson-specification
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOPO_PATH = join(HERE, "countries-topo.json");

interface Topology {
  type: "Topology";
  arcs: number[][][];
  transform: { scale: [number, number]; translate: [number, number] };
  objects: { countries: { type: "GeometryCollection"; geometries: Geom[] } };
}
interface GeomPolygon { type: "Polygon"; arcs: number[][]; properties?: { name?: string } }
interface GeomMulti { type: "MultiPolygon"; arcs: number[][][]; properties?: { name?: string } }
type Geom = GeomPolygon | GeomMulti;

// Country object loaded once, shared.
interface Country { name: string; rings: number[][][]; bbox: [number, number, number, number]; }
let COUNTRIES: Country[] | null = null;

function decodeArc(t: Topology, idx: number): [number, number][] {
  const reverse = idx < 0;
  const i = reverse ? ~idx : idx;
  const arc = t.arcs[i];
  const [sx, sy] = t.transform.scale;
  const [tx, ty] = t.transform.translate;
  let x = 0, y = 0;
  const out: [number, number][] = [];
  for (const [dx, dy] of arc) {
    x += dx; y += dy;
    out.push([x * sx + tx, y * sy + ty]);
  }
  return reverse ? out.reverse() : out;
}

function ringFromArcRefs(t: Topology, refs: number[]): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < refs.length; i++) {
    const seg = decodeArc(t, refs[i]);
    if (i === 0) ring.push(...seg);
    else ring.push(...seg.slice(1));
  }
  return ring;
}

function bboxOf(rings: [number, number][][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function loadCountries(): Country[] {
  if (COUNTRIES) return COUNTRIES;
  const t = JSON.parse(readFileSync(TOPO_PATH, "utf8")) as Topology;
  const out: Country[] = [];
  for (const g of t.objects.countries.geometries) {
    const name = (g as any).properties?.name ?? "??";
    const rings: [number, number][][] = [];
    if (g.type === "Polygon") {
      for (const refs of g.arcs) rings.push(ringFromArcRefs(t, refs));
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.arcs) {
        for (const refs of poly) rings.push(ringFromArcRefs(t, refs));
      }
    }
    out.push({ name, rings, bbox: bboxOf(rings) });
  }
  COUNTRIES = out;
  return out;
}

// Ray-casting point-in-polygon. Works on a single ring.
function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

// Country name → ISO-2. We resolve via a name lookup table since world-atlas-110m
// only carries the friendly name. CC0.
const NAME_TO_ISO2: Record<string, string> = {
  "United States of America": "US", "Canada": "CA", "Mexico": "MX", "Brazil": "BR",
  "Argentina": "AR", "Chile": "CL", "Colombia": "CO", "Peru": "PE", "Venezuela": "VE",
  "Bolivia": "BO", "Ecuador": "EC", "Uruguay": "UY", "Paraguay": "PY", "Guyana": "GY",
  "Suriname": "SR", "Costa Rica": "CR", "Panama": "PA", "Cuba": "CU", "Haiti": "HT",
  "Dominican Republic": "DO", "Jamaica": "JM", "Puerto Rico": "PR",
  "Honduras": "HN", "Nicaragua": "NI", "Guatemala": "GT", "El Salvador": "SV", "Belize": "BZ",
  "United Kingdom": "GB", "Ireland": "IE", "France": "FR", "Germany": "DE", "Italy": "IT",
  "Spain": "ES", "Portugal": "PT", "Netherlands": "NL", "Belgium": "BE", "Luxembourg": "LU",
  "Switzerland": "CH", "Austria": "AT", "Denmark": "DK", "Sweden": "SE", "Norway": "NO",
  "Finland": "FI", "Iceland": "IS", "Poland": "PL", "Czechia": "CZ", "Czech Republic": "CZ",
  "Slovakia": "SK", "Hungary": "HU", "Romania": "RO", "Bulgaria": "BG", "Greece": "GR",
  "Turkey": "TR", "Russia": "RU", "Ukraine": "UA", "Belarus": "BY", "Moldova": "MD",
  "Lithuania": "LT", "Latvia": "LV", "Estonia": "EE", "Croatia": "HR", "Serbia": "RS",
  "Republic of Serbia": "RS",
  "Bosnia and Herzegovina": "BA", "North Macedonia": "MK", "Macedonia": "MK", "Montenegro": "ME",
  "Albania": "AL", "Slovenia": "SI", "Cyprus": "CY", "Northern Cyprus": "CY",
  "Israel": "IL", "Jordan": "JO", "Lebanon": "LB", "Syria": "SY", "Iraq": "IQ", "Iran": "IR",
  "Saudi Arabia": "SA", "Yemen": "YE", "Oman": "OM", "United Arab Emirates": "AE", "Qatar": "QA",
  "Kuwait": "KW", "Egypt": "EG", "Libya": "LY", "Tunisia": "TN", "Algeria": "DZ", "Morocco": "MA",
  "Western Sahara": "EH", "Mauritania": "MR", "Senegal": "SN", "Gambia": "GM", "Guinea": "GN",
  "Sierra Leone": "SL", "Liberia": "LR", "Ivory Coast": "CI", "Cote d'Ivoire": "CI",
  "Côte d'Ivoire": "CI", "Ghana": "GH", "Togo": "TG", "Benin": "BJ", "Nigeria": "NG",
  "Niger": "NE", "Mali": "ML", "Burkina Faso": "BF", "Chad": "TD", "Cameroon": "CM",
  "Central African Republic": "CF", "Democratic Republic of the Congo": "CD",
  "Republic of the Congo": "CG", "Gabon": "GA", "Equatorial Guinea": "GQ", "Angola": "AO",
  "Namibia": "NA", "Botswana": "BW", "South Africa": "ZA", "Lesotho": "LS", "Eswatini": "SZ",
  "Swaziland": "SZ", "Zimbabwe": "ZW", "Mozambique": "MZ", "Malawi": "MW", "Zambia": "ZM",
  "Tanzania": "TZ", "United Republic of Tanzania": "TZ", "Kenya": "KE", "Uganda": "UG",
  "Rwanda": "RW", "Burundi": "BI", "Ethiopia": "ET", "Eritrea": "ER", "Djibouti": "DJ",
  "Somalia": "SO", "Somaliland": "SO", "Sudan": "SD", "South Sudan": "SS", "Madagascar": "MG",
  "India": "IN", "Pakistan": "PK", "Bangladesh": "BD", "Sri Lanka": "LK", "Nepal": "NP",
  "Bhutan": "BT", "Afghanistan": "AF", "China": "CN", "Mongolia": "MN", "Japan": "JP",
  "South Korea": "KR", "North Korea": "KP", "Taiwan": "TW", "Vietnam": "VN", "Laos": "LA",
  "Cambodia": "KH", "Thailand": "TH", "Myanmar": "MM", "Malaysia": "MY", "Singapore": "SG",
  "Indonesia": "ID", "Philippines": "PH", "Brunei": "BN", "East Timor": "TL", "Timor-Leste": "TL",
  "Papua New Guinea": "PG", "Fiji": "FJ", "Solomon Islands": "SB", "Vanuatu": "VU",
  "New Zealand": "NZ", "Australia": "AU",
  "Kazakhstan": "KZ", "Uzbekistan": "UZ", "Turkmenistan": "TM", "Tajikistan": "TJ",
  "Kyrgyzstan": "KG", "Georgia": "GE", "Armenia": "AM", "Azerbaijan": "AZ",
  "Falkland Islands": "FK", "French Southern and Antarctic Lands": "TF", "Antarctica": "AQ",
  "Greenland": "GL", "Kosovo": "XK", "Vatican": "VA",
  "Trinidad and Tobago": "TT",
};

// Public API
export function pointToCountry(lat: number, lon: number): string | null {
  const list = loadCountries();
  for (const c of list) {
    const [minX, minY, maxX, maxY] = c.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    for (const ring of c.rings) {
      if (pointInRing(lon, lat, ring)) {
        return NAME_TO_ISO2[c.name] ?? null;
      }
    }
  }
  return null;
}

export function countryByName(name: string): string | null {
  return NAME_TO_ISO2[name] ?? null;
}

import type { CropId } from "@/lib/crops";
import type { FieldObservation, RetentionRecommendation } from "./contract";
import type { HydroValue, TerrainValue } from "./values";

export const RETENTION_GUIDE = "Retencja wody na polach uprawnych. Poradnik dla rolników, 22.11.2026";
/** The guide, served from public/. */
export const RETENTION_GUIDE_URL = "/poradnik-retencja-wody.pdf";
/** Guide page listing subsidies ("Dopłaty i terminy"). */
export const FUNDING_PAGE = 6;
export const TUZ_RETENTION_FUNDING =
  "Retencja na trwałych użytkach zielonych: projekt stawki 272,21 zł/ha za kampanię 2026 przy zalaniu lub podtopieniu przez co najmniej 12 kolejnych dni od 1 maja do 30 września, stwierdzonym przez IUNG-PIB. Nabór 2026 zakończył się 26 czerwca.";

export function guidePageUrl(page: number) {
  return `${RETENTION_GUIDE_URL}#page=${page}`;
}

type Practice = Omit<RetentionRecommendation, "why" | "needsCheck">;

const PRACTICES = {
  mulch: {
    title: "Mulcz z resztek pożniwnych",
    kind: "agrotechnical",
    nextStep: "Rozdrobnij i rozłóż resztki równomiernie. Przed siewem sprawdź, czy nasiona będą miały kontakt z glebą.",
    cost: "0–150 zł/ha dodatkowej pracy, zależnie od sprzętu i przejazdów. Uwzględnij wartość słomy.",
    sourcePage: 2,
    funding: "Ekoschemat za wymieszanie słomy z glebą: projekt stawki 96,86 zł/ha (kampania 2026). Mulcz pozostawiony na powierzchni nie spełnia tego warunku."
  },
  coverCrop: {
    title: "Międzyplon ozimy lub wsiewka",
    kind: "agrotechnical",
    nextStep: "Dobierz gatunki do zmianowania. Na lekkiej glebie zaplanuj zakończenie międzyplonu według wilgotności, szczególnie podczas suchej wiosny.",
    cost: "400–600 zł/ha za nasiona i siew. Osobno wyceń przygotowanie gleby i zakończenie międzyplonu.",
    sourcePage: 2,
    funding: "Ekoschemat: projekt stawki 484,30 zł/ha za międzyplon ozimy lub wsiewkę (kampania 2026, nabór zakończony 26 czerwca)."
  },
  reducedTillage: {
    title: "Uprawa uproszczona lub pasowa",
    kind: "agrotechnical",
    nextStep: "Sprawdź strukturę i zagęszczenie w odkrywce. Zacznij od pasa próbnego i porównaj wschody oraz wilgotność.",
    cost: "305–400 zł/ha za zabieg agregatem bezorkowym lub ok. 455 zł/ha za siew pasowy (przykład z jednego regionu). Zakres usługi zależy od technologii.",
    sourcePage: 2,
    funding: "Ekoschemat: projekt stawki 290,58 zł/ha za uproszczone systemy uprawy (kampania 2026). Wymaga spełnienia zasad ARiMR i wyłącza uprawę zerową."
  },
  organicMatter: {
    title: "Materia organiczna i zmianowanie",
    kind: "agrotechnical",
    nextStep: "Zaplanuj zmianowanie i pozostawianie resztek. Ewentualną dawkę nawozu organicznego dobierz do wyników badań i planu nawożenia.",
    cost: "430–450 zł/ha za rozrzucenie obornika z załadunkiem. Dolicz materiał i dowóz.",
    sourcePage: 3,
    funding: "Ekoschemat: projekt stawki 193,72 zł/ha za wymieszanie obornika z glebą do 12 godz. (kampania 2026)."
  },
  subsoiling: {
    title: "Miejscowe głęboszowanie",
    kind: "agrotechnical",
    nextStep: "Wyznacz zasięg zbitej warstwy. Zabieg wykonaj miejscowo, gdy warstwa jest przesuszona i się kruszy.",
    cost: "250–450 zł/godz. usługi przed dojazdem, czyli ok. 250–450 zł/ha przy wydajności 1 ha/godz. Koszt pola zależy od powierzchni i wydajności.",
    sourcePage: 3
  },
  contour: {
    title: "Uprawa i siew w poprzek stoku",
    kind: "agrotechnical",
    nextStep: "Na polu sprawdź przebieg stoku, bezpieczny kierunek przejazdu, uwrocia i miejsce odpływu wody.",
    cost: "0–150 zł/ha dodatkowej pracy i nawrotów.",
    sourcePage: 3
  },
  buffer: {
    title: "Zadarniony pas buforowy",
    kind: "retention",
    nextStep: "Po deszczu sprawdź, gdzie spływ jest rozproszony u podnóża stoku lub przy rowie. Skoncentrowany spływ wymaga oceny drogi odpływu.",
    cost: "800–1 200 zł/ha zakładanego pasa. Dolicz dojazd, koszenie i wartość zajętego gruntu.",
    sourcePage: 4
  },
  shelterbelt: {
    title: "Zadrzewienie śródpolne",
    kind: "retention",
    nextStep: "Sprawdź dominujący kierunek wiatru, położenie drenów, dostęp maszyn i wpływ cienia na uprawę.",
    cost: "10–18 tys. zł/ha nasadzeń za sadzonki i założenie pasa. To szacunek ze stawek wsparcia ARiMR, więc poproś lokalnego wykonawcę o wycenę. Dolicz ochronę i pielęgnację.",
    sourcePage: 4,
    funding: "ARiMR I.10.12: 10 892 lub 13 664 zł/ha na założenie, zależnie od nachylenia, oraz premia pielęgnacyjna 2 494 zł/ha rocznie przez 5 lat. Nabór 2026 zakończył się 31 lipca."
  },
  drainage: {
    title: "Ocena możliwości sterowania odpływem",
    kind: "retention",
    nextStep: "Ustal przebieg czynnej sieci i zleć sprawdzenie zasięgu piętrzenia oraz odpływu nadmiaru wody. Ustal wymagania z zarządcą i Wodami Polskimi.",
    cost: "5–15 tys. zł/punkt drenażu lub 25–50 tys. zł/zastawkę przy sprawnej pozostałej sieci.",
    sourcePage: 4,
    funding: "Przy wspólnych rowach zapytaj spółkę wodną o dotacje wojewody na utrzymanie urządzeń."
  },
  pond: {
    title: "Ocena możliwości budowy małego zbiornika",
    kind: "retention",
    nextStep: "Sprawdź dopływ i przelew, warunki gruntowe oraz użyteczną pojemność. Ustal wymagania z Wodami Polskimi przed wyceną robót.",
    cost: "20–60 tys. zł za prosty mały obiekt. Osobno wyceń wywóz ziemi, uszczelnienie i nawadnianie.",
    sourcePage: 5,
    funding: "Programy regionalne, np. w Małopolsce do 50 tys. zł na zbiorniki 100–10 000 m² (nabór zakończony 30 stycznia 2026 r.). Zapytaj urząd marszałkowski o nabór w swoim województwie."
  }
} satisfies Record<string, Practice>;

const PERENNIAL_CROPS = new Set<CropId>([
  "uzytki-zielone", "truskawki", "krzewy-owocowe", "drzewa-owocowe", "chmiel"
]);

export function recommendRetention({ crop, observations, lightSoil, dry, terrain, hydro }: {
  crop: CropId;
  observations: ReadonlySet<FieldObservation>;
  lightSoil: boolean;
  dry: boolean;
  terrain: TerrainValue | null;
  hydro: HydroValue | null;
}): RetentionRecommendation[] {
  const agronomy: RetentionRecommendation[] = [];
  const retention: RetentionRecommendation[] = [];
  const add = (id: keyof typeof PRACTICES, why: string, needsCheck?: true) => {
    const practice = PRACTICES[id];
    const target = practice.kind === "agrotechnical" ? agronomy : retention;
    target.push({ ...practice, why, needsCheck });
  };
  const annual = !PERENNIAL_CROPS.has(crop);
  const bare = observations.has("bareAfterHarvest");
  const rills = observations.has("runoffRills");
  const compacted = observations.has("compactedLayer");
  const ponding = observations.has("ponding");
  const activeDrainage = observations.has("activeDrainage");
  const slope = terrain && terrain.parcelCells >= 3 ? terrain : null;
  const gentle = slope && slope.slopePct.mean >= 0.5 && slope.slopePct.mean <= 5 && slope.steepShare < 0.25;
  const nearDitch = hydro?.ditches.nearestM;

  // Confirmed observations are listed before candidates inferred from maps.
  if (annual && compacted) add("subsoiling", "Odkrywka wykazała zbitą warstwę, która może utrudniać wsiąkanie i wzrost korzeni.");
  else if (annual && ponding) add("subsoiling", "Długie zastoiska mogą wynikać ze zbitej warstwy, która ogranicza wsiąkanie. Najpierw potwierdź ją w odkrywce.", true);
  if (annual && rills && gentle) add("contour", `Widać żłobiny po deszczu, a model terenu wskazuje średni spadek ${slope.slopePct.mean.toLocaleString("pl-PL")}%.`);
  if (annual && bare) add("mulch", "Po zbiorze gleba pozostaje odsłonięta. Resztki mogą ograniczyć parowanie i osłabić spływ.");
  if (observations.has("lowOrganicMatter")) add("organicMatter", "Badanie gleby wykazało mało materii organicznej.");
  if (annual && (bare || (lightSoil && dry))) {
    add("coverCrop", bare ? "Po zbiorze gleba pozostaje odsłonięta." : "Bilans pogody wskazuje niedobory, a model glebowy wskazuje lekką glebę.", bare ? undefined : true);
  }
  if (annual && bare && !compacted && !ponding) {
    add("reducedTillage", "Zgłoszono odsłoniętą glebę po zbiorze. Mniej przejazdów może pomóc zachować okrywę z resztek.", true);
  }

  if (rills) add("buffer", "Żłobiny po deszczu wskazują na spływ powierzchniowy. Pas może wychwycić osad w miejscu, gdzie spływ jest rozproszony.", true);
  if (observations.has("windExposure")) add("shelterbelt", "Rolnik zgłosił przesuszanie odsłoniętego pola przez silny wiatr.", true);
  if (dry && !ponding && (
    (activeDrainage && (!slope || slope.slopePct.mean <= 2)) || (nearDitch != null && nearDitch <= 100 && slope && slope.slopePct.mean <= 2)
  )) {
    add("drainage", activeDrainage ? "Potwierdzono odpływ z pola przez dreny lub rów, a bilans pogody wskazuje niedobory." : `BDOT10k pokazuje rów w odległości ${Math.round(nearDitch!)} m. Na łagodnym terenie warto sprawdzić, czy odbiera wodę z pola.`, true);
  }
  if (dry && (observations.has("reliableInflow") || (slope && slope.relativeElevation <= -1.5))) {
    add("pond", observations.has("reliableInflow") ? "Rolnik potwierdził regularny dopływ wody do obniżenia." : "Model terenu umieszcza działkę niżej od otoczenia. To wskazówka do oględzin dopływu i przelewu.", true);
  }
  if (!rills && nearDitch != null && nearDitch <= 100 && slope?.drainsTowards) {
    add("buffer", `Model wskazuje ogólny spadek na ${slope.drainsTowards}, a BDOT10k pokazuje rów w odległości ${Math.round(nearDitch)} m. Sprawdź, którędy woda opuszcza pole.`, true);
  }

  // Give each applicable kind space in the report, then prefer simpler field practices.
  return [agronomy[0], retention[0], ...agronomy.slice(1), ...retention.slice(1)]
    .filter((practice): practice is RetentionRecommendation => practice !== undefined)
    .slice(0, 3);
}

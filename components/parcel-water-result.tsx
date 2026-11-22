import {
  COST_LABEL, EXCESS_WATER_LABEL, EXCESS_WATER_NOTE, FIELD_CHECK_LABEL, FUNDING_LABEL, PRACTICE_KIND_LABELS,
  WATER_SCORE_LABELS, WATER_UNCERTAINTY_LABELS, type ParcelAnalysis
} from "@/lib/analysis/contract";
import { FUNDING_PAGE, guidePageUrl } from "@/lib/analysis/retention";
import type { MeteoMonthlyHistory, MeteoValue } from "@/lib/analysis/values";
import { formatDatePl } from "@/lib/dates";
import {
  formatDeficitYears, formatHistoricalBalance, MONTHS, SEASONAL_WATER_COLUMNS, SEASONAL_WATER_MISSING, SEASONAL_WATER_NOTE,
  SEASONAL_WATER_TITLE, seasonalWaterSummary
} from "./seasonal-water-balance";

function GuidePage({ page }: { page: number }) {
  return (
    <a href={guidePageUrl(page)} target="_blank" rel="noopener">
      Poradnik, s. {page}
    </a>
  );
}

function SeasonalWaterProfile({ history }: { history: MeteoMonthlyHistory | undefined }) {
  const available = history?.months.some(month => month.yearsWithData);
  const summary = history && seasonalWaterSummary(history);
  return (
    <section className="seasonal-water">
      <h4>{SEASONAL_WATER_TITLE}</h4>
      {history && available ? (
        <>
          <p className="hint">Dane historyczne z lat {history.fromYear}–{history.toYear}</p>
          {summary && <p>{summary}</p>}
          <details className="preview__detail">
            <summary>Zobacz wszystkie miesiące</summary>
            <table className="seasonal-water__table">
              <thead>
                <tr>{SEASONAL_WATER_COLUMNS.map(column => <th key={column} scope="col">{column}</th>)}</tr>
              </thead>
              <tbody>
                {history.months.map(month => (
                  <tr key={month.month}>
                    <th scope="row">{MONTHS[month.month]}</th>
                    <td>{formatHistoricalBalance(month.medianBalance)}</td>
                    <td>
                      <span className="seasonal-water__frequency">
                        {formatDeficitYears(month)}
                        {month.yearsWithData > 0 && (
                          <meter min={0} max={month.yearsWithData} value={month.deficitYears} aria-hidden="true" />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">{SEASONAL_WATER_NOTE}</p>
          </details>
        </>
      ) : <p className="hint">{SEASONAL_WATER_MISSING}</p>}
    </section>
  );
}

export function ParcelWaterResult({ result, date }: { result: ParcelAnalysis; date: string }) {
  const { assessment, modules } = result;
  const parcel = result.parcel.properties;
  const meteo = modules.find(module => module.module === "meteo")?.value as MeteoValue | null | undefined;
  const { score, excessWater, summary, uncertainty, evidence, recommendations } = assessment;
  return (
    <>
      <h3 className="preview__parcel">Działka {parcel.number}, obręb {parcel.precinct}</h3>
      <h4 className="water-score__heading">Ocena na {formatDatePl(date)}</h4>
      <p className="water-score" data-score={score ?? undefined}>
        {score === null ? <strong>Brak oceny</strong> : <><strong>{score}/5</strong> {WATER_SCORE_LABELS[score]}</>}
      </p>
      {excessWater && (
        <p className="water-excess">
          <strong>{EXCESS_WATER_LABEL}.</strong> {EXCESS_WATER_NOTE}
        </p>
      )}
      <p className="preview__lede">{summary}</p>
      {uncertainty && <p className="hint">Niepewność oceny jest {WATER_UNCERTAINTY_LABELS[uncertainty]}.</p>}
      {evidence.length > 0 && (
        <details className="preview__detail">
          <summary>Co wpływa na ocenę</summary>
          <ul className="preview__evidence">
            {evidence.map(item => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}
      <SeasonalWaterProfile history={meteo?.monthlyHistory} />
      {recommendations.length > 0 ? (
        <>
          <h4 className="preview__subtitle">Co możesz zrobić</h4>
          <ul className="preview__recommendations">
            {recommendations.map(practice => (
              <li key={practice.title}>
                <p className="preview__practice-type">
                  {PRACTICE_KIND_LABELS[practice.kind]}
                  {practice.needsCheck && ` · ${FIELD_CHECK_LABEL}`}
                </p>
                <h5>{practice.title}</h5>
                <p>{practice.why}</p>
                <p>{practice.nextStep}</p>
                <p className="hint">
                  {COST_LABEL}: {practice.cost} <GuidePage page={practice.sourcePage} />.
                </p>
                {practice.funding && (
                  <p className="hint">
                    {FUNDING_LABEL}: {practice.funding} <GuidePage page={FUNDING_PAGE} />.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : score !== null && (
        <p className="hint">W dostępnych danych brak podstaw do wskazania konkretnego zabiegu. Obserwacje z pola mogą uzupełnić wynik.</p>
      )}
    </>
  );
}

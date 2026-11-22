import {
  COST_LABEL, EXCESS_WATER_LABEL, EXCESS_WATER_NOTE, FIELD_CHECK_LABEL, FUNDING_LABEL, PRACTICE_KIND_LABELS,
  WATER_SCORE_LABELS, WATER_UNCERTAINTY_LABELS, type WaterAssessment
} from "@/lib/analysis/contract";
import { FUNDING_PAGE, guidePageUrl } from "@/lib/analysis/retention";
import type { ParcelProps } from "@/lib/parcels/types";

function GuidePage({ page }: { page: number }) {
  return (
    <a href={guidePageUrl(page)} target="_blank" rel="noopener">
      Poradnik, s. {page}
    </a>
  );
}

export function ParcelWaterResult({ assessment, parcel }: { assessment: WaterAssessment; parcel: ParcelProps }) {
  const { score, excessWater, summary, uncertainty, evidence, recommendations } = assessment;
  return (
    <>
      <h3 className="preview__parcel">Działka {parcel.number}, obręb {parcel.precinct}</h3>
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

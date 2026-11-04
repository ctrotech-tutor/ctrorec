import { useState } from 'react'

export function CaptureEvidenceExport({
  institutionId,
}: Readonly<{ institutionId: string }>) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const parameters = new URLSearchParams()
  if (from) {
    parameters.set('from', from)
  }
  if (to) {
    parameters.set('to', to)
  }
  const query = parameters.toString()
  const invalidRange = Boolean(from && to && from > to)
  const href = `/api/institutions/${encodeURIComponent(institutionId)}/admin/capture-evidence.csv${query ? `?${query}` : ''}`

  return (
    <section
      className="admin-section capture-evidence"
      aria-labelledby="capture-evidence-title"
    >
      <div className="admin-section-heading">
        <h3 id="capture-evidence-title">Capture evidence</h3>
      </div>
      <p className="admin-hint">
        Export operational capture and derivative metrics for the approved field
        pilot. Join them to the field sheet by capture reference. This export
        contains no student roster, storage key, or audio URL.
      </p>
      <div className="admin-form capture-evidence-form">
        <div className="admin-form-grid">
          <label>
            From (UTC)
            <input
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              type="date"
              value={from}
            />
          </label>
          <label>
            To (UTC)
            <input
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              type="date"
              value={to}
            />
          </label>
        </div>
        {invalidRange ? (
          <p className="form-error" role="alert">
            The from date must not follow the to date.
          </p>
        ) : null}
        <a
          aria-disabled={invalidRange || undefined}
          className="secondary-button"
          download
          href={invalidRange ? undefined : href}
          onClick={(event) => {
            if (invalidRange) {
              event.preventDefault()
            }
          }}
        >
          Download capture evidence CSV
        </a>
      </div>
      <p className="admin-hint">
        Dates filter capture start; the to date is inclusive. Exports are
        limited to 5,000 captures.
      </p>
    </section>
  )
}

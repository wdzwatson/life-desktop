export const NOTE_EXPORT_STYLES = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #24292f;
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 20px;
  }
  h1, h2, h3, h4, h5, h6 {
    color: #111827;
    margin-top: 24px;
    margin-bottom: 12px;
    font-weight: 650;
    line-height: 1.3;
  }
  h1 { font-size: 2.25em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
  h2 { font-size: 1.7em; border-bottom: 1px solid #d8dee4; padding-bottom: 0.25em; }
  h3 { font-size: 1.35em; }
  h4 { font-size: 1.15em; }
  h5 { font-size: 1em; }
  h6 { font-size: 0.92em; color: #4b5563; }
  p, blockquote, ul, ol, dl, table, pre { margin-top: 0; margin-bottom: 16px; }
  ul ul, ol ol, ul ol, ol ul { margin-top: 6px; margin-bottom: 6px; }
  code {
    padding: 0.2em 0.4em;
    font-size: 85%;
    background-color: #f3f4f6;
    border-radius: 3px;
    font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
  }
  pre { padding: 16px; overflow: auto; background-color: #f6f8fa; border-radius: 3px; }
  blockquote { padding: 0 1em; color: #57606a; border-left: 4px solid #d0d7de; }
  table { border-collapse: collapse; width: 100%; }
  table th, table td { padding: 6px 13px; border: 1px solid #d0d7de; }
  table tr:nth-child(even) { background-color: #f6f8fa; }
  img { max-width: 100%; box-sizing: content-box; }
  a { color: #0969da; text-decoration: underline; }
  .reader-export-annotation {
    position: relative;
    margin: 14px 0;
    padding: 10px 12px 10px 42px;
    border: 1px solid #d0d7de;
    border-left: 4px solid #6b7280;
    border-radius: 6px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .reader-export-annotation > ul { margin-bottom: 0; padding-left: 20px; }
  .reader-export-annotation__icon {
    position: absolute;
    top: 11px;
    left: 12px;
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 1px solid currentColor;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }
  .reader-export-annotation.is-translation { border-left-color: #2563eb; background: #eff6ff; }
  .reader-export-annotation.is-translation .reader-export-annotation__icon { color: #1d4ed8; }
  .reader-export-annotation.is-underline { border-left-color: #d97706; background: #fffbeb; }
  .reader-export-annotation.is-underline .reader-export-annotation__icon { color: #b45309; }
  .reader-export-annotation.is-note { border-left-color: #16a34a; background: #f0fdf4; }
  .reader-export-annotation.is-note .reader-export-annotation__icon { color: #15803d; }
  @media print {
    body { max-width: none; padding: 0; }
    a { color: #111827; }
  }
`

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const buildNoteExportHtml = (title: string, htmlContent: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${NOTE_EXPORT_STYLES}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <main>${htmlContent || ''}</main>
</body>
</html>`

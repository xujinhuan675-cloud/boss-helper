export function exportCsv(headers: string[], rows: string[][], name: string) {
  const cell = (value: string) => {
    const safeValue = /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value
    return `"${safeValue.replaceAll('"', '""')}"`
  }
  const content = [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = `${name}.csv`
  try {
    link.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

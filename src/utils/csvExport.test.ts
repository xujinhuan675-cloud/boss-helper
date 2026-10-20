// @ts-nocheck
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { exportCsv } from './csvExport'

const originalDocument = globalThis.document
const spies: Array<ReturnType<typeof spyOn>> = []

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  globalThis.document = originalDocument
})

describe('CSV download', () => {
  it('downloads a UTF-8 spreadsheet with escaped cells and formula protection', async () => {
    let downloaded: Blob | undefined
    let cleanup: (() => void) | undefined
    const link = {
      href: '',
      download: '',
      click() {
        expect(this.href).toBe('blob:csv-export')
        expect(this.download).toBe('jobs.csv')
      },
    }
    globalThis.document = { createElement: () => link }
    spies.push(
      spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        downloaded = blob
        return 'blob:csv-export'
      }),
    )
    const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    spies.push(revoke)
    spies.push(
      spyOn(globalThis, 'setTimeout').mockImplementation((callback) => {
        cleanup = callback
        return 1
      }),
    )

    exportCsv(
      ['岗位', '备注'],
      [
        ['产品经理', '研发, "AI"'],
        ['=1+1', '第二行\n备注'],
      ],
      'jobs',
    )

    expect(downloaded?.type).toBe('text/csv;charset=utf-8')
    expect([...new Uint8Array(await downloaded!.arrayBuffer()).slice(0, 3)]).toEqual([
      0xef, 0xbb, 0xbf,
    ])
    expect(await downloaded!.text()).toBe(
      '"岗位","备注"\r\n"产品经理","研发, ""AI"""\r\n"\'=1+1","第二行\n备注"',
    )
    expect(revoke).not.toHaveBeenCalled()
    cleanup!()
    expect(revoke).toHaveBeenCalledWith('blob:csv-export')
  })
})

// @ts-nocheck
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { exportJson } from './jsonImportExport'

const originalDocument = globalThis.document
const spies: Array<ReturnType<typeof spyOn>> = []

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  globalThis.document = originalDocument
})

describe('JSON download', () => {
  it('downloads the complete saved records and releases the object URL after the click', async () => {
    const records = [
      {
        encryptJobId: 'saved-1',
        snapshot: { jobName: 'AI产品经理' },
        detail: { jobInfo: { postDescription: '已保存的JD' } },
        sourceKeywords: ['AI'],
        batches: ['batch-1'],
        reviewStatus: 'approved',
        sendStatus: 'unknown',
        failureReason: '详情超时',
      },
    ]
    let downloaded: Blob | undefined
    let cleanup: (() => void) | undefined
    const link = {
      href: '',
      download: '',
      click() {
        expect(this.href).toBe('blob:local-backup')
        expect(this.download).toBe('boss-job-library.json')
        expect(revoke).not.toHaveBeenCalled()
      },
    }
    globalThis.document = { createElement: () => link }
    spies.push(
      spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        downloaded = blob
        return 'blob:local-backup'
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

    exportJson(records, 'boss-job-library')

    expect(downloaded?.type).toStartWith('application/json')
    expect(JSON.parse(await downloaded!.text())).toEqual(records)
    expect(revoke).not.toHaveBeenCalled()
    cleanup!()
    expect(revoke).toHaveBeenCalledWith('blob:local-backup')
  })
})

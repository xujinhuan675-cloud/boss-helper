// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, test } from 'bun:test'

import {
  buildNativeSearchUrl,
  isNativeSearchFilters,
  nativeSearchFromUrl,
  parseNativeSearchOptions,
} from './nativeSearch'

describe('BOSS native search filters', () => {
  const href =
    'https://www.zhipin.com/web/geek/jobs?query=产品经理&city=101020100&salary=405&experience=104,105&degree=203&stage=803,804&scale=303&industry=100001&position=100101&areaBusiness=abc&page=3&ka=header-jobs'

  test('reads native codes and preserves multiple selections', () => {
    expect(nativeSearchFromUrl(href)).toEqual({
      query: '产品经理',
      city: '101020100',
      jobType: '',
      salary: '405',
      experience: ['104', '105'],
      degree: ['203'],
      stage: ['803', '804'],
      scale: ['303'],
      industry: ['100001'],
    })
  })

  test('clears unrestricted filters while preserving unrelated BOSS conditions', () => {
    const filters = nativeSearchFromUrl(href)
    filters.salary = ''
    filters.experience = []
    filters.query = ' AI产品经理 '
    const url = buildNativeSearchUrl(href, filters)
    expect(url.searchParams.get('salary')).toBeNull()
    expect(url.searchParams.get('experience')).toBeNull()
    expect(url.searchParams.get('query')).toBe('AI产品经理')
    expect(url.searchParams.get('stage')).toBe('803,804')
    expect(url.searchParams.get('position')).toBe('100101')
    expect(url.searchParams.get('areaBusiness')).toBe('abc')
    expect(url.searchParams.get('page')).toBeNull()
    expect(url.pathname).toBe('/web/geek/jobs')
  })

  test('changes city without retaining the previous city district or subway', () => {
    const filters = nativeSearchFromUrl(href)
    filters.city = '101010100'
    const url = buildNativeSearchUrl(
      href + '&multiBusinessDistrict=1&multiSubway=2&businessDistrict=3',
      filters,
    )
    for (const key of ['areaBusiness', 'multiBusinessDistrict', 'multiSubway', 'businessDistrict'])
      expect(url.searchParams.has(key)).toBe(false)
    expect(url.searchParams.get('city')).toBe('101010100')
  })

  test('rejects arbitrary fields, URLs, and malformed codes at the command boundary', () => {
    const filters = nativeSearchFromUrl(href)
    expect(isNativeSearchFilters(filters)).toBe(true)
    for (const patch of [
      { salary: '405&url=evil' },
      { experience: ['0', '104'] },
      { industry: ['1', '2', '3', '4'] },
      { url: 'https://example.com' },
      { query: 'x'.repeat(101) },
      { city: null },
    ])
      expect(isNativeSearchFilters({ ...filters, ...patch })).toBe(false)
    expect(() => buildNativeSearchUrl('https://example.com/web/geek/jobs', filters)).toThrow()
    expect(() => buildNativeSearchUrl('https://www.zhipin.com/web/geek/chat', filters)).toThrow()
  })

  test('normalizes native unrestricted values to empty selections', () => {
    expect(
      nativeSearchFromUrl('https://www.zhipin.com/web/geek/jobs?salary=0&experience=0&stage=0'),
    ).toMatchObject({ salary: '', experience: [], stage: [] })
    expect(nativeSearchFromUrl('https://www.zhipin.com/web/geek/jobs?query=0').query).toBe('0')
  })

  test('uses official option labels and leaf codes for cities and industries', () => {
    const options = parseNativeSearchOptions(
      {
        code: 0,
        zpData: {
          salaryList: [
            { code: 0, name: '不限' },
            { code: 405, name: '10-20K' },
          ],
        },
      },
      ['salaryList'],
    )
    expect(options.salaryList).toEqual([
      { value: '', label: '不限' },
      { value: '405', label: '10-20K' },
    ])
    const tree = parseNativeSearchOptions({
      code: 0,
      zpData: [
        { code: 100000, name: '互联网', subLevelModelList: [{ code: 100001, name: '电子商务' }] },
      ],
    })
    expect(tree).toEqual([{ value: '100001', label: '电子商务' }])
    const city = parseNativeSearchOptions(
      {
        code: 0,
        zpData: {
          cityList: [
            {
              code: 101000000,
              name: '北京',
              subLevelModelList: [
                {
                  code: 101010100,
                  name: '北京市',
                  subLevelModelList: [{ code: 101010101, name: '海淀区' }],
                },
              ],
            },
          ],
        },
      },
      ['cityList'],
    )
    expect(city.cityList).toEqual([{ value: '101010100', label: '北京市' }])
    expect(() => parseNativeSearchOptions({ code: 37, zpData: [] })).toThrow()
    expect(() =>
      parseNativeSearchOptions({ code: 0, zpData: [{ code: 'broken', name: '错误' }] }),
    ).toThrow()
  })
})

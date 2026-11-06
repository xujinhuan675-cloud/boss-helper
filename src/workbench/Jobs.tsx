/** @jsxImportSource react */
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dropdown,
  Link,
  Modal,
  Pagination,
  Popover,
  SearchField,
  Table,
  Tabs,
} from '@heroui/react'
import {
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Filter,
  FilterX,
  ListRestart,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from 'react'
import type { SortDescriptor } from 'react-aria-components'

import { MATCH_SCORING_VERSION } from '@/composables/useApplying/scoring'
import {
  filterJobLibrary,
  FUNNEL_STAGES,
  getJobReviewStatus,
  getJobFunnelStage,
  isFunnelStage,
  sortJobLibraryByMatch,
} from '@/entrypoints/boss/jobStore'
import type {
  BossJobLibraryRecord,
  DetailStatus,
  FunnelStage,
  ProcessingStatusFilter,
  ReviewStatus,
} from '@/entrypoints/boss/jobStore'
import { exportCsv } from '@/utils/csvExport'

import { getSavedJobData } from '../entrypoints/boss/jobData'
import { parseHistoricalJobLibrary, parseJobLibraryCsv } from '../entrypoints/boss/jobImport'
import { ConfirmDialog, IconButton, MultiSelectField, SelectField, act } from './components'
import { DeliveryStatistics } from './DeliveryStatistics'
import { JobAnalysisResult } from './JobAnalysisResult'
import {
  getResumeTailoringInputError,
  openResumeMatcher,
  RESUME_MATCHER_BASE_URL,
} from './resumeMatcher'
import {
  command,
  selectTab,
  deleteSavedJob,
  deleteSavedJobs,
  generateSavedGreeting,
  importSavedJobs,
  refreshLibrary,
  startSavedAnalysis,
  stopSavedAnalysis,
  updateSavedJob,
} from './store'
import { statusNames } from './Tasks'
import { useWorkbench } from './useWorkbench'

const stages: Record<FunnelStage, string> = {
  collected: '已采集',
  matched: '已匹配',
  applied: '已投递',
  replied: '已回复',
  interview: '面试中',
  offer: '已获 Offer',
}
// Keep legacy stages readable, but do not offer them for new manual updates.
const selectableFunnelStages = FUNNEL_STAGES.filter(
  (value): value is FunnelStage => value !== 'interview' && value !== 'offer',
)
const all = { value: 'all', label: '全部' }
const timestamp = (value: string) => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
const time = (value: string) =>
  timestamp(value) === null ? '未记录' : new Date(value).toLocaleString('zh-CN', { hour12: false })
function matchLabel(record: BossJobLibraryRecord) {
  const analysis = record.analysis
  if (analysis?.scoringVersion === MATCH_SCORING_VERSION)
    return analysis.passed === true ? '匹配' : analysis.passed === false ? '不匹配' : '待确认'
  return typeof analysis?.rating === 'number'
    ? `${analysis.needsConfirmation ? '暂定 ' : ''}${analysis.rating}/100`
    : statusNames[record.analysisStatus] || '待分析'
}
function monthlySalary(value: string | undefined) {
  // shortcut: 只比较可折算的月薪、年薪，日薪和时薪待有统一工时口径后再支持。
  const match = value
    ?.replace(/\s/g, '')
    .match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?(K|千|万|元)(?:\/(月|年))?(?:·(\d+)薪)?$/i)
  if (!match?.[3]) return null
  const lower = Number(match[1])
  const upper = Number(match[2] || match[1])
  if (lower <= 0 || upper < lower || !Number.isFinite(upper)) return null
  const unit = match[3].toUpperCase()
  const multiplier = unit === '万' ? 10000 : unit === 'K' || unit === '千' ? 1000 : 1
  const months = match[4] === '年' ? 1 : Number(match[5] || 12)
  const salary = (lower * multiplier * months) / 12
  return Number.isFinite(salary) && salary > 0 ? salary : null
}
function sortJobs(records: BossJobLibraryRecord[], descriptor: SortDescriptor) {
  if (descriptor.column === 'match') return sortJobLibraryByMatch(records, descriptor.direction)
  const getValue = (record: BossJobLibraryRecord) => {
    if (descriptor.column === 'job') return record.snapshot.jobName || ''
    if (descriptor.column === 'company')
      return record.detail?.brandComInfo?.brandName || record.snapshot.brandName || ''
    if (descriptor.column === 'salary') return monthlySalary(record.snapshot.salaryDesc)
    if (descriptor.column === 'collectedAt') return timestamp(record.firstSeenAt)
    if (descriptor.column === 'stage') return FUNNEL_STAGES.indexOf(getJobFunnelStage(record))
    if (typeof record.analysis?.rating === 'number' && Number.isFinite(record.analysis.rating))
      return record.analysis.rating
    return null
  }
  return [...records].sort((a, b) => {
    const aValue = getValue(a)
    const bValue = getValue(b)
    if (aValue === null && bValue === null) return 0
    if (aValue === null) return 1
    if (bValue === null) return -1
    const result =
      typeof aValue === 'number' && typeof bValue === 'number'
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), 'zh-CN')
    return descriptor.direction === 'ascending' ? result : -result
  })
}

export function Jobs() {
  const state = useWorkbench()
  const importInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('all')
  const [keyword, setKeyword] = useState('all')
  const [detail, setDetail] = useState('all')
  const [stage, setStage] = useState<string[]>([])
  const [matchedToday, setMatchedToday] = useState(
    () => new URLSearchParams(location.search).get('matched') === 'today',
  )
  const [processing, setProcessing] = useState('active')
  const [matchStatus, setMatchStatus] = useState<ReviewStatus[]>([])
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState('')
  const [detailTab, setDetailTab] = useState('jd')
  const [tailorError, setTailorError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'collectedAt',
    direction: 'descending',
  })
  const [deleting, setDeleting] = useState<BossJobLibraryRecord | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchGreetingConfirm, setBatchGreetingConfirm] = useState(false)
  const [tailorBatchIndex, setTailorBatchIndex] = useState<number | null>(null)
  const [sendConfirm, setSendConfirm] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState('')
  const records = useMemo(
    () =>
      sortJobs(
        filterJobLibrary(state.records, {
          search,
          company: company === 'all' ? '' : company,
          sourceKeyword: keyword === 'all' ? '' : keyword,
          detailStatus: detail === 'all' ? '' : (detail as DetailStatus),
          funnelStage: '',
          processingStatus: processing as ProcessingStatusFilter,
          matchStatus: 'all',
          matchedToday,
        }),
        sortDescriptor,
      ).filter(
        (record) =>
          (!stage.length || stage.includes(getJobFunnelStage(record))) &&
          (!matchStatus.length || matchStatus.includes(getJobReviewStatus(record))),
      ),
    [
      state.records,
      search,
      company,
      keyword,
      detail,
      stage,
      processing,
      matchStatus,
      matchedToday,
      sortDescriptor,
    ],
  )
  useEffect(
    () => setPage(1),
    [search, company, keyword, detail, stage, processing, matchStatus, matchedToday],
  )
  useEffect(() => {
    const ids = new Set(records.map((record) => record.encryptJobId))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [records])
  const pages = Math.max(1, Math.ceil(records.length / 20))
  const currentPage = Math.min(page, pages)
  const pageRecords = records.slice((currentPage - 1) * 20, currentPage * 20)
  const pageIds = pageRecords.map((record) => record.encryptJobId)
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const selected = state.records.find((record) => record.encryptJobId === selectedId)
  const greetingJobIds = records
    .filter(
      (record) =>
        record.processingStatus !== 'excluded' &&
        record.detailStatus === 'complete' &&
        !!record.detail?.jobInfo?.postDescription?.trim() &&
        !record.finalGreeting?.trim() &&
        record.reviewStatus === 'pending' &&
        record.sendStatus === 'pending',
    )
    .map((record) => record.encryptJobId)
  const analysisJobIds = state.records
    .filter(
      (record) =>
        record.processingStatus !== 'excluded' &&
        record.detailStatus === 'complete' &&
        !!record.detail?.jobInfo?.postDescription?.trim() &&
        record.analysisStatus !== 'ready' &&
        record.reviewStatus === 'pending' &&
        record.sendStatus === 'pending',
    )
    .map((record) => record.encryptJobId)
  const tailorJobIds = records
    .filter(
      (record) =>
        record.processingStatus !== 'excluded' &&
        record.detailStatus === 'complete' &&
        !!record.detail?.jobInfo?.postDescription?.trim(),
    )
    .map((record) => record.encryptJobId)
  const selectedJob = selected ? getSavedJobData(selected).jobData : null
  useEffect(() => {
    setDetailTab('jd')
    setTailorError('')
  }, [selectedId])
  const busy = state.analysisBusy
  const disabled = state.loading || state.saving || busy
  const liveHistory = state.runtime?.historyDetailRun
  const historyBusy =
    !!liveHistory &&
    ['running', 'paused'].includes(liveHistory.status) &&
    !!state.runtime?.gatheringBusy
  const history =
    historyBusy || (liveHistory?.error && !liveHistory.id) ? liveHistory : state.historyDetailRun
  const historyPending = !!history && history.cursor < history.total
  const historyLocked = !!history?.owner && history.expiresAt > Date.now()
  const detailStartDisabled =
    disabled ||
    !state.connected ||
    historyLocked ||
    state.runtime?.gatheringBusy ||
    state.runtime?.analysisBusy ||
    state.runtime?.keywordRotationBusy ||
    state.runtime?.realtimeBusy ||
    state.runtime?.workflow?.status === 'running'
  const options = (items: (string | undefined)[]) => [
    all,
    ...[...new Set(items)]
      .filter((value): value is string => !!value)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((value) => ({ value, label: value })),
  ]
  const mutate = async (work: () => Promise<unknown>) => {
    const success = await act(work)
    if (success) await refreshLibrary()
    return success
  }

  function tailorSelectedJob() {
    setTailorError('')
    if (!selectedJob) return
    const inputError = getResumeTailoringInputError(selectedJob)
    if (inputError) {
      setTailorError(inputError)
      return
    }
    if (!openResumeMatcher(selectedJob)) {
      setTailorError('浏览器阻止了新标签页，请允许弹出窗口后重试')
    }
  }

  function selectDetailTab(key: Key) {
    setDetailTab(String(key))
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">岗位库</h1>
          <p className="mt-1 text-sm text-muted">{state.records.length} 个已保存岗位</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.tabs.length > 1 && (
            <div className="w-64 max-w-full">
              <SelectField
                label="历史补全执行页"
                hideLabel
                value={String(state.tabId)}
                options={state.tabs.map((tab) => ({ value: String(tab.id), label: tab.title }))}
                disabled={historyBusy || state.saving}
                onChange={(value) => selectTab(Number(value))}
              />
            </div>
          )}
        </div>
      </div>
      {history && (
        <div role="status" aria-live="polite" className="space-y-1 text-sm text-muted">
          <p>{`历史补全 · ${statusNames[history.status] || history.status} · 已处理 ${history.cursor} / ${history.total} · 补全 ${history.completed} · 失败 ${history.failed} · 跳过 ${history.skipped}`}</p>
          {historyBusy && (
            <p>
              {[
                history.currentJob,
                history.phase,
                history.waitSeconds ? `${history.waitSeconds} 秒` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {historyLocked && !historyBusy && (
            <p>历史补全由其他页面执行；页面关闭后最多等待 90 秒可继续。</p>
          )}
          {history.error && <p className="text-danger">{history.error}</p>}
        </div>
      )}
      {state.libraryError && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>{state.libraryError}</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      <Tabs defaultSelectedKey="list" className="w-full">
        <Tabs.ListContainer>
          <Tabs.List aria-label="岗位库视图">
            <Tabs.Tab id="list">
              岗位列表
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="statistics">
              投递统计
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="list" className="space-y-5 pt-4">
          {state.analysisRun && (
            <div className="text-sm text-muted" role="status" aria-live="polite">
              {`${statusNames[state.analysisRun.status] || state.analysisRun.status} · 已保存 ${state.analysisRun.completed} / ${state.analysisRun.total} · 失败 ${state.analysisRun.failed} · 跳过 ${state.analysisRun.skipped}`}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted">筛选结果 {records.length}</span>
              {!!selectedIds.size && (
                <span className="text-sm text-muted">已选 {selectedIds.size}</span>
              )}
            </div>
            <div
              role="group"
              aria-label="岗位库操作"
              className="flex flex-wrap items-center justify-end gap-1"
            >
              <input
                ref={importInput}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                className="sr-only"
                aria-label="导入历史岗位 JSON 或 CSV"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (!file) return
                  setImporting(true)
                  setImportSummary('')
                  void act(async () => {
                    const content = await file.text()
                    let records
                    let removedCount = 0
                    if (file.name.toLowerCase().endsWith('.json')) {
                      const source = JSON.parse(content)
                      records = parseHistoricalJobLibrary(source, file.name)
                      removedCount = source.length - records.length
                    } else {
                      records = parseJobLibraryCsv(content, file.name)
                    }
                    const result = await importSavedJobs(records)
                    setImportSummary(
                      `导入完成：新增 ${result.newCount} 条，跳过已有 ${result.duplicateCount} 条，剔除异常 ${removedCount} 条`,
                    )
                  }).finally(() => setImporting(false))
                }}
              />
              {!!selectedIds.size && (
                <Button
                  size="sm"
                  variant="danger-soft"
                  isDisabled={disabled}
                  onPress={() => setBatchDeleting(true)}
                >
                  <Trash2 size={15} />
                  删除已选 ({selectedIds.size})
                </Button>
              )}
              <SearchField
                aria-label="搜索岗位、公司或 JD"
                value={search}
                onChange={setSearch}
                className="w-64 max-w-full"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input className="min-w-0" placeholder="搜索岗位、公司或 JD" />
                  <SearchField.ClearButton aria-label="清空岗位搜索" />
                </SearchField.Group>
              </SearchField>
              <Popover isOpen={filtersOpen} onOpenChange={setFiltersOpen}>
                <Button
                  size="sm"
                  variant={filtersOpen ? 'secondary' : 'ghost'}
                  aria-expanded={filtersOpen}
                >
                  <Filter size={15} />
                  筛选
                </Button>
                <Popover.Content
                  placement="bottom end"
                  className="w-[min(760px,calc(100vw-32px))] max-h-[min(70vh,560px)] overflow-y-auto"
                >
                  <Popover.Dialog className="space-y-4">
                    <Popover.Heading>岗位筛选</Popover.Heading>
                    <search className="job-filters" aria-label="岗位筛选">
                      <SelectField
                        label="公司"
                        value={company}
                        onChange={setCompany}
                        options={options(
                          state.records.flatMap((record) => [
                            record.snapshot.brandName,
                            record.detail?.brandComInfo?.brandName,
                            record.detail?.bossInfo?.brandName,
                          ]),
                        )}
                      />
                      <SelectField
                        label="来源关键词"
                        value={keyword}
                        onChange={setKeyword}
                        options={options(state.records.flatMap((record) => record.sourceKeywords))}
                      />
                      <SelectField
                        label="详情状态"
                        value={detail}
                        onChange={setDetail}
                        options={[
                          all,
                          { value: 'pending', label: '待补全' },
                          { value: 'complete', label: '已完成' },
                          { value: 'failed', label: '失败待重试' },
                        ]}
                      />
                      <MultiSelectField
                        label="跟进阶段"
                        value={stage}
                        onChange={setStage}
                        options={[
                          ...selectableFunnelStages.map((value) => ({
                            value,
                            label: `${stages[value]}及以上`,
                          })),
                        ]}
                      />
                      <MultiSelectField
                        label="匹配度"
                        value={matchStatus}
                        onChange={(value) => setMatchStatus(value as ReviewStatus[])}
                        options={[
                          { value: 'approved', label: '匹配' },
                          { value: 'rejected', label: '不匹配' },
                          { value: 'pending', label: '待分析/待确认' },
                        ]}
                      />
                      <SelectField
                        label="处理状态"
                        value={processing}
                        onChange={setProcessing}
                        options={[
                          { value: 'active', label: '正常岗位' },
                          { value: 'excluded', label: '已排除 / 已结束' },
                          all,
                        ]}
                      />
                      <SelectField
                        label="匹配时间"
                        value={matchedToday ? 'today' : 'all'}
                        onChange={(value) => setMatchedToday(value === 'today')}
                        options={[all, { value: 'today', label: '今日匹配' }]}
                      />
                    </search>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          setSearch('')
                          setCompany('all')
                          setKeyword('all')
                          setDetail('all')
                          setStage([])
                          setProcessing('active')
                          setMatchStatus([])
                          setMatchedToday(false)
                        }}
                      >
                        <FilterX size={15} />
                        清除筛选
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={!records.length || !!state.libraryError}
                        onPress={() => {
                          const headers = [
                            '岗位名称',
                            '公司',
                            '薪资',
                            '地点',
                            '匹配度',
                            '跟进阶段',
                            '采集时间',
                            '岗位链接',
                            '职位描述',
                          ]
                          const rows = records.map((record) => [
                            record.snapshot.jobName || '',
                            record.detail?.brandComInfo?.brandName ||
                              record.snapshot.brandName ||
                              '',
                            record.snapshot.salaryDesc || '',
                            [record.snapshot.cityName, record.snapshot.areaDistrict]
                              .filter(Boolean)
                              .join(' · '),
                            matchLabel(record),
                            record.processingStatus === 'excluded'
                              ? '本地排除'
                              : stages[getJobFunnelStage(record)],
                            timestamp(record.firstSeenAt) === null
                              ? ''
                              : new Date(record.firstSeenAt).toLocaleString('zh-CN', {
                                  hour12: false,
                                }),
                            record.jobUrl || '',
                            record.detail?.jobInfo?.postDescription || '',
                          ])
                          exportCsv(headers, rows, 'OfferHunt-job-library-filtered')
                        }}
                      >
                        <Download size={15} />
                        导出
                      </Button>
                    </div>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover>
              <Dropdown>
                <Button size="sm" variant="ghost">
                  <Ellipsis size={15} />
                  更多
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu aria-label="更多">
                    {historyBusy ? (
                      <>
                        <Dropdown.Item
                          isDisabled={state.saving || !state.connected}
                          onAction={() =>
                            void act(() =>
                              command({
                                type:
                                  history?.status === 'paused'
                                    ? 'resumeGathering'
                                    : 'pauseGathering',
                              }),
                            )
                          }
                        >
                          {history?.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}
                          {history?.status === 'paused' ? '继续' : '暂停补全'}
                        </Dropdown.Item>
                        <Dropdown.Item
                          isDisabled={state.saving || !state.connected}
                          onAction={() => void act(() => command({ type: 'stopGathering' }))}
                        >
                          <Square size={15} />
                          停止补全
                        </Dropdown.Item>
                      </>
                    ) : (
                      <Dropdown.Item
                        isDisabled={!!detailStartDisabled}
                        onAction={() =>
                          void act(() =>
                            command({
                              type: historyPending ? 'resumeHistory' : 'completeHistory',
                            }),
                          )
                        }
                      >
                        <ListRestart size={15} />
                        {historyPending ? '继续补全' : '补全'}
                      </Dropdown.Item>
                    )}
                    {!state.analysisBusy ? (
                      <Dropdown.Item
                        isDisabled={disabled || !analysisJobIds.length}
                        onAction={() =>
                          void act(() => startSavedAnalysis({ limit: Number.MAX_SAFE_INTEGER }))
                        }
                      >
                        <WandSparkles size={15} />
                        分析 ({analysisJobIds.length})
                      </Dropdown.Item>
                    ) : (
                      <Dropdown.Item
                        isDisabled={state.saving || state.analysisRun?.status === 'stopping'}
                        onAction={() => void act(stopSavedAnalysis)}
                      >
                        <Square size={15} />
                        停止分析
                      </Dropdown.Item>
                    )}
                    <Dropdown.Item
                      isDisabled={disabled || !greetingJobIds.length}
                      onAction={() => setBatchGreetingConfirm(true)}
                    >
                      <MessageSquareText size={15} />
                      批量生成招呼语 ({greetingJobIds.length})
                    </Dropdown.Item>
                    <Dropdown.Item
                      isDisabled={!tailorJobIds.length}
                      onAction={() => setTailorBatchIndex(0)}
                    >
                      <WandSparkles size={15} />
                      批量定制简历 ({tailorJobIds.length})
                    </Dropdown.Item>
                    <Dropdown.Item
                      isDisabled={disabled || importing}
                      onAction={() => importInput.current?.click()}
                    >
                      <Upload size={15} />
                      导入
                    </Dropdown.Item>
                    <Dropdown.Item onAction={() => void refreshLibrary()}>
                      <RefreshCw size={15} />
                      刷新
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </div>
          {importSummary && (
            <p className="text-sm text-muted" role="status" aria-live="polite">
              {importSummary}
            </p>
          )}
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="已保存岗位"
                className="min-w-260"
                sortDescriptor={sortDescriptor}
                onSortChange={(descriptor) => {
                  setSortDescriptor(descriptor)
                  setPage(1)
                }}
              >
                <Table.Header>
                  <Table.Column id="select" className="w-10">
                    <Checkbox
                      slot={null}
                      aria-label="选择当前页岗位"
                      isSelected={allPageSelected}
                      isIndeterminate={selectedOnPage > 0 && !allPageSelected}
                      isDisabled={disabled || !pageIds.length}
                      onChange={(checked) => {
                        setSelectedIds((current) => {
                          const next = new Set(current)
                          for (const id of pageIds) {
                            if (checked) next.add(id)
                            else next.delete(id)
                          }
                          return next
                        })
                      }}
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                  </Table.Column>
                  <Table.Column id="job" isRowHeader allowsSorting>
                    {({ sortDirection }) => (
                      <Table.SortableColumnHeader sortDirection={sortDirection}>
                        岗位
                      </Table.SortableColumnHeader>
                    )}
                  </Table.Column>
                  <Table.Column id="company" allowsSorting>
                    {({ sortDirection }) => (
                      <Table.SortableColumnHeader sortDirection={sortDirection}>
                        公司
                      </Table.SortableColumnHeader>
                    )}
                  </Table.Column>
                  <Table.Column id="salary" allowsSorting className="whitespace-nowrap">
                    {({ sortDirection }) => (
                      <Table.SortableColumnHeader sortDirection={sortDirection}>
                        薪资
                      </Table.SortableColumnHeader>
                    )}
                  </Table.Column>
                  <Table.Column id="location">地点</Table.Column>
                  <Table.Column id="match" allowsSorting className="whitespace-nowrap">
                    {({ sortDirection }) => (
                      <Table.SortableColumnHeader sortDirection={sortDirection}>
                        匹配度
                      </Table.SortableColumnHeader>
                    )}
                  </Table.Column>
                  <Table.Column id="stage" allowsSorting className="whitespace-nowrap">
                    {({ sortDirection }) => (
                      <Table.SortableColumnHeader sortDirection={sortDirection}>
                        跟进阶段
                      </Table.SortableColumnHeader>
                    )}
                  </Table.Column>
                  <Table.Column id="collectedAt" allowsSorting className="whitespace-nowrap">
                    {({ sortDirection }) => (
                      <Table.SortableColumnHeader sortDirection={sortDirection}>
                        采集时间
                      </Table.SortableColumnHeader>
                    )}
                  </Table.Column>
                  <Table.Column className="text-end">操作</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <p className="p-10 text-center text-muted">
                      {state.libraryError ? '岗位库未能读取' : '暂无符合条件的岗位'}
                    </p>
                  )}
                >
                  {pageRecords.map((record, index) => (
                    <Table.Row
                      key={record.encryptJobId}
                      id={record.encryptJobId}
                      className={`cursor-pointer ${index % 2 === 1 ? 'bg-default/30' : ''}`}
                      onAction={() => {
                        setSelectedId(record.encryptJobId)
                        setDetailTab('jd')
                      }}
                    >
                      <Table.Cell>
                        <Checkbox
                          slot={null}
                          aria-label={`选择岗位 ${record.snapshot.jobName || '未命名岗位'}`}
                          isSelected={selectedIds.has(record.encryptJobId)}
                          isDisabled={disabled}
                          onChange={(checked) => {
                            setSelectedIds((current) => {
                              const next = new Set(current)
                              if (checked) next.add(record.encryptJobId)
                              else next.delete(record.encryptJobId)
                              return next
                            })
                          }}
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-medium break-words">{record.snapshot.jobName}</span>
                        {record.detailStatus === 'failed' && (
                          <span className="mt-1 block text-xs text-danger">详情补全失败</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {record.detail?.brandComInfo?.brandName || record.snapshot.brandName}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        {record.snapshot.salaryDesc || '未记录'}
                      </Table.Cell>
                      <Table.Cell>
                        {[record.snapshot.cityName, record.snapshot.areaDistrict]
                          .filter(Boolean)
                          .join(' · ') || '未记录'}
                      </Table.Cell>
                      <Table.Cell className="tabular-nums whitespace-nowrap">
                        {matchLabel(record)}
                      </Table.Cell>
                      <Table.Cell>
                        <Chip
                          size="sm"
                          color={
                            record.processingStatus !== 'excluded' &&
                            getJobFunnelStage(record) === 'applied'
                              ? 'accent'
                              : 'default'
                          }
                        >
                          {record.processingStatus === 'excluded'
                            ? '本地排除'
                            : stages[getJobFunnelStage(record)]}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        {timestamp(record.firstSeenAt) === null ? (
                          '未记录'
                        ) : (
                          <time dateTime={record.firstSeenAt}>{time(record.firstSeenAt)}</time>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-end">
                        <IconButton
                          label={`删除岗位 ${record.snapshot.jobName || '未命名岗位'}`}
                          disabled={disabled}
                          onPress={() => setDeleting(record)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          <Pagination aria-label="岗位分页">
            <Pagination.Summary>
              第 {currentPage} / {pages} 页
            </Pagination.Summary>
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous
                  isDisabled={currentPage === 1}
                  onPress={() => setPage(currentPage - 1)}
                >
                  <Pagination.PreviousIcon />
                  上一页
                </Pagination.Previous>
              </Pagination.Item>
              <Pagination.Item>
                <Pagination.Next
                  isDisabled={currentPage === pages}
                  onPress={() => setPage(currentPage + 1)}
                >
                  下一页
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
        </Tabs.Panel>
        <Tabs.Panel id="statistics">
          <DeliveryStatistics />
        </Tabs.Panel>
      </Tabs>
      <Modal.Backdrop
        isOpen={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId('')
            setDetailTab('jd')
          }
        }}
      >
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{selected?.snapshot.jobName || '岗位详情'}</Modal.Heading>
            </Modal.Header>
            {selected && (
              <>
                <Modal.Body className="job-detail space-y-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p>
                        {selected.detail?.brandComInfo?.brandName || selected.snapshot.brandName}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {selected.snapshot.salaryDesc} · {selected.snapshot.cityName} ·{' '}
                        {selected.snapshot.jobExperience} · {selected.snapshot.jobDegree}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        window.open(
                          `https://www.zhipin.com/job_detail/${encodeURIComponent(selected.encryptJobId)}.html`,
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }}
                    >
                      <ExternalLink size={15} />
                      BOSS 岗位
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <SelectField
                      label="匹配度"
                      value={getJobReviewStatus(selected)}
                      options={[
                        { value: 'pending', label: '待确认' },
                        { value: 'approved', label: '匹配' },
                        { value: 'rejected', label: '不匹配' },
                      ]}
                      disabled={disabled}
                      onChange={(value) => {
                        void mutate(() =>
                          updateSavedJob({
                            type: 'review',
                            jobId: selected.encryptJobId,
                            status: value as ReviewStatus,
                          }),
                        )
                      }}
                    />
                    <SelectField
                      label="跟进阶段"
                      value={selected.manualFunnelStage || 'auto'}
                      options={[
                        {
                          value: 'auto',
                          label: `自动判断 · ${stages[getJobFunnelStage({ ...selected, manualFunnelStage: undefined })]}`,
                        },
                        ...selectableFunnelStages.map((value) => ({ value, label: stages[value] })),
                      ]}
                      disabled={disabled}
                      onChange={(value) => {
                        void mutate(() =>
                          updateSavedJob({
                            type: 'funnel',
                            jobId: selected.encryptJobId,
                            stage: value === 'auto' ? null : (value as FunnelStage),
                          }),
                        )
                      }}
                    />
                    <SelectField
                      label="处理状态"
                      value={selected.processingStatus || 'active'}
                      options={[
                        { value: 'active', label: '正常岗位' },
                        { value: 'excluded', label: '已排除 / 已结束' },
                      ]}
                      disabled={disabled}
                      onChange={(value) => {
                        void mutate(() =>
                          updateSavedJob({
                            type: 'processing',
                            jobId: selected.encryptJobId,
                            status: value as 'active' | 'excluded',
                          }),
                        )
                      }}
                    />
                  </div>
                  <Tabs selectedKey={detailTab} onSelectionChange={selectDetailTab}>
                    <Tabs.ListContainer>
                      <Tabs.List aria-label="岗位详情内容">
                        <Tabs.Tab id="jd">
                          JD
                          <Tabs.Indicator />
                        </Tabs.Tab>
                        <Tabs.Tab id="analysis">
                          AI 分析
                          <Tabs.Indicator />
                        </Tabs.Tab>
                        <Tabs.Tab id="greeting">
                          招呼语
                          <Tabs.Indicator />
                        </Tabs.Tab>
                        <Tabs.Tab id="tailor">
                          定制简历
                          <Tabs.Indicator />
                        </Tabs.Tab>
                      </Tabs.List>
                    </Tabs.ListContainer>
                    <Tabs.Panel id="jd" className="space-y-4 pt-4">
                      <p className="whitespace-pre-wrap text-sm">
                        {selected.detail?.jobInfo?.postDescription || '详情尚未补全'}
                      </p>
                      <dl className="space-y-2 text-xs text-muted">
                        <div>详情状态：{statusNames[selected.detailStatus]}</div>
                        <div>来源关键词：{selected.sourceKeywords.join('、') || '未记录'}</div>
                        <div>首次采集：{time(selected.firstSeenAt)}</div>
                        <div>最近采集：{time(selected.lastSeenAt)}</div>
                      </dl>
                      {selected.failureReason && (
                        <p className="text-sm text-danger">{selected.failureReason}</p>
                      )}
                    </Tabs.Panel>
                    <Tabs.Panel id="analysis" className="space-y-4 pt-4">
                      <JobAnalysisResult record={selected} />
                    </Tabs.Panel>
                    <Tabs.Panel id="greeting" className="space-y-4 pt-4">
                      <p className="whitespace-pre-wrap text-sm">
                        {selected.finalGreeting || '尚未生成招呼语'}
                      </p>
                      <p className="text-sm text-muted">
                        发送状态：
                        {
                          {
                            pending: '未发送',
                            queued: '待发送',
                            sent: '已发送',
                            unknown: '发送结果未知',
                            failed: '发送失败',
                          }[selected.sendStatus]
                        }
                      </p>
                    </Tabs.Panel>
                    <Tabs.Panel id="tailor" className="space-y-4 pt-4">
                      <dl className="grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted">岗位</dt>
                          <dd className="break-words">
                            {selected.snapshot.jobName || '未命名岗位'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">公司</dt>
                          <dd className="break-words">
                            {selected.detail?.brandComInfo?.brandName ||
                              selected.snapshot.brandName ||
                              '未记录'}
                          </dd>
                        </div>
                      </dl>
                      {tailorError && (
                        <p role="alert" className="text-sm break-words text-danger">
                          {tailorError}
                        </p>
                      )}
                      <Link
                        href={`${RESUME_MATCHER_BASE_URL}/tailor`}
                        target="_blank"
                        className="button button--sm button--primary inline-flex items-center gap-2"
                        onClick={(event) => {
                          event.preventDefault()
                          tailorSelectedJob()
                        }}
                      >
                        <ExternalLink size={16} />
                        在 Resume Matcher 中定制
                      </Link>
                    </Tabs.Panel>
                  </Tabs>
                </Modal.Body>
                {(detailTab === 'analysis' || detailTab === 'greeting') && (
                  <Modal.Footer className="flex flex-wrap justify-end gap-2">
                    {detailTab === 'analysis' ? (
                      <Button
                        variant="secondary"
                        isDisabled={
                          disabled ||
                          selected.detailStatus !== 'complete' ||
                          !selected.detail?.jobInfo?.postDescription?.trim() ||
                          selected.processingStatus === 'excluded' ||
                          selected.sendStatus !== 'pending'
                        }
                        onPress={() => {
                          void act(() => startSavedAnalysis({ jobId: selected.encryptJobId }))
                        }}
                      >
                        <WandSparkles size={16} />
                        {selected.analysisStatus === 'ready' ? '重新分析' : '分析此岗位'}
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          isDisabled={!selected.finalGreeting}
                          onPress={() => {
                            void act(
                              () => navigator.clipboard.writeText(selected.finalGreeting || ''),
                              '已复制招呼语',
                            )
                          }}
                        >
                          <Copy size={16} />
                          复制
                        </Button>
                        <Button
                          variant="secondary"
                          isDisabled={
                            disabled ||
                            selected.detailStatus !== 'complete' ||
                            !selected.detail?.jobInfo?.postDescription?.trim() ||
                            selected.processingStatus === 'excluded' ||
                            selected.reviewStatus !== 'pending' ||
                            selected.sendStatus !== 'pending'
                          }
                          onPress={() => {
                            void act(() => generateSavedGreeting(selected.encryptJobId))
                          }}
                        >
                          <MessageSquareText size={16} />
                          生成招呼语
                        </Button>
                        <Button
                          isDisabled={
                            disabled ||
                            !state.connected ||
                            state.runtime?.gatheringBusy ||
                            state.runtime?.analysisBusy ||
                            state.runtime?.keywordRotationBusy ||
                            state.runtime?.realtimeBusy ||
                            !selected.finalGreeting ||
                            selected.processingStatus === 'excluded'
                          }
                          onPress={() => setSendConfirm(true)}
                        >
                          <Send size={16} />
                          发送招呼语
                        </Button>
                      </>
                    )}
                  </Modal.Footer>
                )}
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <ConfirmDialog
        open={tailorBatchIndex !== null}
        onClose={() => setTailorBatchIndex(null)}
        title="批量定制简历"
        confirmLabel={
          tailorBatchIndex !== null && tailorBatchIndex < tailorJobIds.length - 1
            ? '打开并继续下一条'
            : '打开岗位'
        }
        onConfirm={() => {
          if (tailorBatchIndex === null) return
          const record = state.records.find(
            (item) => item.encryptJobId === tailorJobIds[tailorBatchIndex],
          )
          if (!record) {
            setTailorBatchIndex(null)
            return
          }
          const job = getSavedJobData(record).jobData
          const inputError = getResumeTailoringInputError(job)
          if (inputError) {
            window.alert(inputError)
            return
          }
          if (!openResumeMatcher(job)) {
            window.alert('浏览器阻止了新标签页，请允许弹窗后重试')
            return
          }
          if (tailorBatchIndex + 1 >= tailorJobIds.length) setTailorBatchIndex(null)
          else setTailorBatchIndex(tailorBatchIndex + 1)
        }}
      >
        {tailorBatchIndex !== null && (
          <p>
            {tailorBatchIndex + 1} / {tailorJobIds.length}：
            {state.records.find((item) => item.encryptJobId === tailorJobIds[tailorBatchIndex])
              ?.snapshot.jobName || '未命名岗位'}
            。打开当前岗位的定制页面后，返回此处继续下一条。
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={batchGreetingConfirm}
        onClose={() => setBatchGreetingConfirm(false)}
        title="确认批量生成招呼语"
        confirmLabel="开始生成"
        disabled={disabled}
        onConfirm={async () => {
          const jobIds = [...greetingJobIds]
          setBatchGreetingConfirm(false)
          let completed = 0
          let failed = 0
          for (const jobId of jobIds) {
            if (await act(() => generateSavedGreeting(jobId))) completed++
            else failed++
          }
          await act(async () => {
            await refreshLibrary()
            window.alert(`批量生成完成：成功 ${completed} 条，失败 ${failed} 条`)
          })
        }}
      >
        <p>将为当前筛选结果中符合条件的 {greetingJobIds.length} 个岗位生成招呼语，不会自动发送。</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!deleting || batchDeleting}
        onClose={() => {
          setDeleting(null)
          setBatchDeleting(false)
        }}
        title={batchDeleting ? '确认批量删除岗位' : '确认删除岗位'}
        confirmLabel="删除"
        danger
        disabled={disabled}
        onConfirm={() => {
          if (batchDeleting) {
            void mutate(() => deleteSavedJobs([...selectedIds])).then((ok) => {
              if (ok) {
                setSelectedId((current) => (selectedIds.has(current) ? '' : current))
                setSelectedIds(new Set())
                setBatchDeleting(false)
              }
            })
            return
          }
          if (deleting)
            void mutate(() => deleteSavedJob(deleting.encryptJobId)).then((ok) => {
              if (ok) {
                setSelectedIds((current) => {
                  const next = new Set(current)
                  next.delete(deleting.encryptJobId)
                  return next
                })
                setSelectedId((selected) => (selected === deleting.encryptJobId ? '' : selected))
                setDeleting(null)
              }
            })
        }}
      >
        {batchDeleting ? (
          <p>
            确定从本地岗位库删除已选的 {selectedIds.size} 个岗位？后续再次采集时仍可能重新保存。
          </p>
        ) : (
          <p>
            确定从本地岗位库删除“{deleting?.snapshot.jobName || '未命名岗位'}
            ”？后续再次采集时仍可能重新保存。
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={sendConfirm && !!selected}
        onClose={() => setSendConfirm(false)}
        title="确认发送招呼语"
        confirmLabel="发送"
        disabled={state.saving}
        onConfirm={() => {
          if (selected)
            void act(() =>
              command({
                type: 'sendGreeting',
                jobId: selected.encryptJobId,
                greeting: selected.finalGreeting || '',
              }),
            ).then((ok) => {
              if (ok) setSendConfirm(false)
            })
        }}
      >
        <p>
          将向 {selected?.snapshot.brandName} 的「{selected?.snapshot.jobName}」发送已保存的招呼语。
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">{selected?.finalGreeting}</p>
      </ConfirmDialog>
    </section>
  )
}

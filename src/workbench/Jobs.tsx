/** @jsxImportSource react */
import {
  Alert,
  Button,
  Chip,
  Label,
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
  ExternalLink,
  Filter,
  FilterX,
  RefreshCw,
  Send,
  Square,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { formatFilteringMessage } from '@/composables/useApplying/scoring'
import {
  filterJobLibrary,
  FUNNEL_STAGES,
  getJobFunnelStage,
  isFunnelStage,
  sortJobLibraryByMatch,
} from '@/entrypoints/boss/jobStore'
import type { DetailStatus, FunnelStage, ProcessingStatusFilter } from '@/entrypoints/boss/jobStore'
import { exportJson } from '@/utils/jsonImportExport'

import { ConfirmDialog, IconButton, SelectField, act } from './components'
import { DeliveryStatistics } from './DeliveryStatistics'
import {
  command,
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
const all = { value: 'all', label: '全部' }
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export function Jobs() {
  const state = useWorkbench()
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('all')
  const [keyword, setKeyword] = useState('all')
  const [detail, setDetail] = useState('all')
  const [stage, setStage] = useState(() => {
    const value = new URLSearchParams(location.search).get('stage')
    return isFunnelStage(value) ? value : 'all'
  })
  const [matchedToday, setMatchedToday] = useState(
    () => new URLSearchParams(location.search).get('matched') === 'today',
  )
  const [processing, setProcessing] = useState('active')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState('')
  const [sendConfirm, setSendConfirm] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const records = useMemo(
    () =>
      sortJobLibraryByMatch(
        filterJobLibrary(state.records, {
          search,
          company: company === 'all' ? '' : company,
          sourceKeyword: keyword === 'all' ? '' : keyword,
          detailStatus: detail === 'all' ? '' : (detail as DetailStatus),
          funnelStage: stage === 'all' ? '' : (stage as FunnelStage),
          processingStatus: processing as ProcessingStatusFilter,
          matchedToday,
        }),
      ),
    [state.records, search, company, keyword, detail, stage, processing, matchedToday],
  )
  useEffect(() => setPage(1), [search, company, keyword, detail, stage, processing, matchedToday])
  const pages = Math.max(1, Math.ceil(records.length / 20))
  const currentPage = Math.min(page, pages)
  const selected = state.records.find((record) => record.encryptJobId === selectedId)
  const busy = state.analysisBusy
  const disabled = state.loading || state.saving || busy
  const options = (items: (string | undefined)[]) => [
    all,
    ...[...new Set(items)]
      .filter((value): value is string => !!value)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((value) => ({ value, label: value })),
  ]
  const mutate = async (work: () => Promise<unknown>) => {
    if (await act(work)) await refreshLibrary()
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">岗位库</h1>
          <p className="mt-1 text-sm text-muted">{state.records.length} 个已保存岗位</p>
        </div>
        <div className="flex justify-end">
          <IconButton
            label="刷新岗位库"
            onPress={() => {
              void refreshLibrary()
            }}
          >
            <RefreshCw size={17} />
          </IconButton>
        </div>
      </div>
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
            <span className="text-sm text-muted">筛选结果 {records.length}</span>
            <div className="flex gap-1">
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
                      <SearchField value={search} onChange={setSearch} fullWidth>
                        <Label>岗位 / JD</Label>
                        <SearchField.Group>
                          <SearchField.SearchIcon />
                          <SearchField.Input
                            className="min-w-0"
                            placeholder="搜索岗位、公司或 JD"
                          />
                          <SearchField.ClearButton aria-label="清空岗位搜索" />
                        </SearchField.Group>
                      </SearchField>
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
                      <SelectField
                        label="漏斗阶段"
                        value={stage}
                        onChange={setStage}
                        options={[
                          all,
                          ...FUNNEL_STAGES.map((value) => ({
                            value,
                            label: `${stages[value]}及以上`,
                          })),
                        ]}
                      />
                      <SelectField
                        label="处理状态"
                        value={processing}
                        onChange={setProcessing}
                        options={[
                          { value: 'active', label: '正常岗位' },
                          { value: 'excluded', label: '本地排除' },
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
                          setStage('all')
                          setProcessing('active')
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
                          void act(async () =>
                            exportJson(records, 'OfferHunt-job-library-filtered'),
                          )
                        }}
                      >
                        <Download size={15} />
                        导出筛选结果
                      </Button>
                    </div>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover>
              {!state.analysisBusy ? (
                <Button
                  size="sm"
                  isDisabled={disabled}
                  onPress={() => {
                    void act(() => startSavedAnalysis({ limit: Number.MAX_SAFE_INTEGER }))
                  }}
                >
                  <WandSparkles size={15} />
                  分析待处理岗位
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="danger-soft"
                  isDisabled={state.saving || state.analysisRun?.status === 'stopping'}
                  onPress={() => {
                    void act(stopSavedAnalysis)
                  }}
                >
                  <Square size={15} />
                  停止分析
                </Button>
              )}
            </div>
          </div>
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="已保存岗位" className="min-w-180">
                <Table.Header>
                  <Table.Column isRowHeader>岗位</Table.Column>
                  <Table.Column>公司</Table.Column>
                  <Table.Column className="whitespace-nowrap">匹配</Table.Column>
                  <Table.Column className="whitespace-nowrap">阶段</Table.Column>
                  <Table.Column className="whitespace-nowrap">详情</Table.Column>
                  <Table.Column className="text-end">操作</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <p className="p-10 text-center text-muted">
                      {state.libraryError ? '岗位库未能读取' : '暂无符合条件的岗位'}
                    </p>
                  )}
                >
                  {records.slice((currentPage - 1) * 20, currentPage * 20).map((record) => (
                    <Table.Row key={record.encryptJobId} id={record.encryptJobId}>
                      <Table.Cell>
                        <span className="font-medium break-words">{record.snapshot.jobName}</span>
                        <span className="mt-1 block text-xs text-muted">
                          {record.snapshot.salaryDesc}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        {record.detail?.brandComInfo?.brandName || record.snapshot.brandName}
                      </Table.Cell>
                      <Table.Cell className="tabular-nums whitespace-nowrap">
                        {typeof record.analysis?.rating === 'number'
                          ? `${record.analysis.needsConfirmation ? '暂定 ' : ''}${record.analysis.rating}/100`
                          : statusNames[record.analysisStatus] || '待分析'}
                      </Table.Cell>
                      <Table.Cell>
                        <Chip size="sm">
                          {record.processingStatus === 'excluded'
                            ? '本地排除'
                            : stages[getJobFunnelStage(record)]}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        {statusNames[record.detailStatus]}
                      </Table.Cell>
                      <Table.Cell className="text-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => setSelectedId(record.encryptJobId)}
                        >
                          查看
                        </Button>
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
          if (!open) setSelectedId('')
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
                  <div className="field-grid">
                    <SelectField
                      label="漏斗阶段"
                      value={selected.manualFunnelStage || 'auto'}
                      options={[
                        {
                          value: 'auto',
                          label: `自动判断 · ${stages[getJobFunnelStage({ ...selected, manualFunnelStage: undefined })]}`,
                        },
                        ...FUNNEL_STAGES.map((value) => ({ value, label: stages[value] })),
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
                        { value: 'excluded', label: '本地排除' },
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
                  <Tabs defaultSelectedKey="jd">
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
                      </Tabs.List>
                    </Tabs.ListContainer>
                    <Tabs.Panel id="jd" className="space-y-4 pt-4">
                      <p className="whitespace-pre-wrap text-sm">
                        {selected.detail?.jobInfo?.postDescription || '详情尚未补全'}
                      </p>
                      <dl className="space-y-2 text-xs text-muted">
                        <div>来源关键词：{selected.sourceKeywords.join('、') || '未记录'}</div>
                        <div>首次采集：{time(selected.firstSeenAt)}</div>
                        <div>最近采集：{time(selected.lastSeenAt)}</div>
                      </dl>
                      {selected.failureReason && (
                        <p className="text-sm text-danger">{selected.failureReason}</p>
                      )}
                    </Tabs.Panel>
                    <Tabs.Panel id="analysis" className="space-y-4 pt-4">
                      <p className="text-sm font-medium">
                        {selected.analysis?.passed === true
                          ? '通过筛选'
                          : selected.analysis?.passed === false
                            ? '未通过筛选'
                            : selected.analysis?.needsConfirmation
                              ? '待确认'
                              : '待分析'}
                      </p>
                      <pre className="text-sm">
                        {selected.analysis?.res
                          ? formatFilteringMessage(JSON.stringify(selected.analysis.res))
                          : selected.analysis
                            ? JSON.stringify(selected.analysis, null, 2)
                            : '尚无分析结果'}
                      </pre>
                      {selected.analysisFailureReason && (
                        <p className="text-sm text-danger">{selected.analysisFailureReason}</p>
                      )}
                      <Button
                        variant="secondary"
                        isDisabled={
                          disabled ||
                          selected.detailStatus !== 'complete' ||
                          !selected.detail?.jobInfo?.postDescription?.trim() ||
                          selected.processingStatus === 'excluded' ||
                          selected.analysisStatus === 'ready' ||
                          selected.reviewStatus !== 'pending' ||
                          selected.sendStatus !== 'pending'
                        }
                        onPress={() => {
                          void act(() => startSavedAnalysis({ jobId: selected.encryptJobId }))
                        }}
                      >
                        <WandSparkles size={16} />
                        分析此岗位
                      </Button>
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
                      <div className="flex flex-wrap gap-2">
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
                      </div>
                    </Tabs.Panel>
                  </Tabs>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onPress={() => setSelectedId('')}>
                    关闭
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <ConfirmDialog
        open={sendConfirm && !!selected}
        onClose={() => setSendConfirm(false)}
        title="确认发送招呼语"
        confirmLabel="发送"
        disabled={state.saving}
        onConfirm={() => {
          if (selected)
            void act(() => command({ type: 'sendGreeting', jobId: selected.encryptJobId })).then(
              (ok) => {
                if (ok) setSendConfirm(false)
              },
            )
        }}
      >
        <p>
          将向 {selected?.snapshot.brandName} 的「{selected?.snapshot.jobName}」发送已保存的招呼语。
        </p>
      </ConfirmDialog>
    </section>
  )
}

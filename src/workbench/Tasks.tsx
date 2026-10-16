/** @jsxImportSource react */
import {
  Accordion,
  Alert,
  Button,
  Chip,
  Label,
  Link,
  ProgressBar,
  Switch,
  Table,
} from '@heroui/react'
import {
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  ListRestart,
  Pause,
  Play,
  RotateCcw,
  Save,
  ScanLine,
  Square,
  WandSparkles,
} from 'lucide-react'
import { useState } from 'react'

import { getJobFunnel } from '@/entrypoints/boss/jobStore'

import { ConfirmDialog, IconButton, SelectField, act } from './components'
import type { ExecutorCommand } from './protocol'
import { statisticsHistory } from './statistics'
import { command } from './store'
import { useWorkbench } from './useWorkbench'

export const statusNames: Record<string, string> = {
  running: '进行中',
  paused: '已暂停',
  stopped: '已停止',
  completed: '已完成',
  failed: '失败',
  stopping: '正在停止',
  idle: '未启动',
  stop: '已暂停',
  ready: '已就绪',
  login_required: '需登录',
  captcha: '需验证',
  restricted: '访问受限',
  network_error: '网络失败',
  unknown_error: '需检查',
  pending: '待处理',
  complete: '已补全',
  success: '成功',
  error: '失败',
  warn: '已过滤',
  wait: '等待',
  request: '请求中',
  ai: '分析中',
}

export function Tasks({ compact = false }: { compact?: boolean }) {
  const state = useWorkbench()
  const runtime = state.runtime
  const [deliveryConfirm, setDeliveryConfirm] = useState(false)
  const [historyDays, setHistoryDays] = useState('7')
  const busy = !!(
    runtime?.gatheringBusy ||
    runtime?.analysisBusy ||
    runtime?.keywordRotationBusy ||
    runtime?.realtimeBusy ||
    runtime?.workflow?.status === 'running'
  )
  const disabled = !state.connected || state.saving
  const startDisabled = disabled || busy
  const funnel = getJobFunnel(state.records)
  const run = runtime?.gatheringKind === 'detail' ? runtime.detailRun : runtime?.collectionRun
  const current = runtime?.jobs.find((job) => job.key === runtime.currentJob)
  const rotation = runtime?.keywordRotation
  const history = statisticsHistory(
    state.today,
    state.statistics,
    historyDays === 'all' ? null : Number(historyDays),
  )
  const execute = (type: ExecutorCommand['type']) => {
    void act(() => command({ type } as ExecutorCommand))
  }

  return (
    <section className="space-y-6">
      {!compact && (
        <div>
          <h1 className="text-2xl font-semibold">任务</h1>
          <p className="mt-1 text-sm text-muted">
            {current?.jobName || (busy ? '任务运行中' : '当前没有进行中的任务')}
          </p>
        </div>
      )}
      <nav
        aria-label="岗位统计入口"
        className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'} gap-x-4 gap-y-5 border-b border-border pb-5`}
      >
        {[
          { label: '已采集', count: funnel.collected, query: '' },
          { label: '已匹配', count: funnel.matched, query: '?stage=matched' },
          { label: '已投递', count: funnel.applied, query: '?stage=applied' },
          { label: '今日匹配', count: funnel.matchedToday, query: '?matched=today' },
        ].map(({ label, count, query }) => (
          <Link
            key={label}
            href={`./workbench.html${query}#jobs`}
            target={compact ? '_blank' : undefined}
            rel={compact ? 'noreferrer' : undefined}
            aria-label={`查看${label}岗位，共 ${count} 个`}
            className="group block w-full min-w-0 rounded-lg p-2 text-foreground no-underline transition-colors hover:bg-default/50"
          >
            <span className="flex items-center justify-between gap-2 text-sm text-muted">
              {label}
              <ArrowUpRight size={15} aria-hidden="true" className="shrink-0" />
            </span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums group-hover:text-accent">
              {count}
            </span>
          </Link>
        ))}
      </nav>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">任务操作</h2>
          <Chip size="sm" color={busy ? 'accent' : 'default'}>
            {busy ? '运行中' : '待命'}
          </Chip>
        </div>
        <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'} gap-2`}>
          <Button
            fullWidth
            variant="primary"
            isDisabled={startDisabled || !runtime?.keywords.trim()}
            onPress={() => execute('rotate')}
          >
            <ListRestart size={16} />
            {rotation?.status === 'paused' ? '继续轮换' : '轮换采集并分析'}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            isDisabled={startDisabled}
            onPress={() => execute('collect')}
          >
            <ScanLine size={16} />
            只采集
          </Button>
          {runtime?.workflow?.status === 'running' ? (
            <Button
              fullWidth
              variant="danger-soft"
              isDisabled={disabled}
              onPress={() => execute('stopDelivery')}
            >
              <Square size={16} />
              停止投递
            </Button>
          ) : (
            <Button
              fullWidth
              variant="secondary"
              isDisabled={startDisabled}
              onPress={() => setDeliveryConfirm(true)}
            >
              <Play size={16} />
              {runtime?.workflow?.status === 'stop' ? '继续投递' : '开始投递'}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            今日投递 {state.today?.success ?? 0} / {state.config.deliveryLimit.value}
          </span>
          <span>
            本页 {runtime?.workflow?.current ?? 0} / {runtime?.workflow?.total ?? 0}
          </span>
          {runtime?.workflow?.status === 'stop' && (
            <Button
              size="sm"
              variant="ghost"
              isDisabled={disabled || busy}
              onPress={() => execute('resetDelivery')}
            >
              <RotateCcw size={14} />
              重置进度
            </Button>
          )}
        </div>
        <Switch
          isSelected={runtime?.autoCaptureEnabled ?? false}
          isDisabled={disabled || busy}
          onChange={(enabled) => {
            void act(() => command({ type: 'setAutoCapture', enabled }))
          }}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <Label>浏览时自动采集岗位</Label>
          </Switch.Content>
        </Switch>
        {rotation && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-words">
              关键词轮换 · {statusNames[rotation.status] || rotation.status}
            </span>
            {runtime?.keywordRotationBusy && (
              <Button
                size="sm"
                variant="danger-soft"
                isDisabled={disabled}
                onPress={() => execute('stopRotation')}
              >
                <Square size={14} />
                停止轮换
              </Button>
            )}
          </div>
        )}
        {rotation?.error && (
          <p className="text-sm text-danger" role="alert">
            {rotation.error}
          </p>
        )}
        {!!runtime?.keywordRotationWaitSeconds && runtime.keywordRotationBusy && (
          <output className="block text-sm text-muted">
            {rotation?.nextKeywordIsBatchRest ? '批次休息' : '关键词冷却'} · 剩余{' '}
            {runtime.keywordRotationWaitSeconds} 秒
          </output>
        )}
        {run && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{runtime?.gatheringKind === 'detail' ? '详情补全' : '岗位采集'}</span>
              <Chip size="sm">{statusNames[run.status] || run.status}</Chip>
            </div>
            <p className="text-sm text-muted break-words">
              {run.phase || ''}
              {run.waitSeconds ? ` · 等待 ${run.waitSeconds} 秒` : ''}
            </p>
            {runtime?.gatheringKind === 'collection' ? (
              <p className="text-sm">
                本轮新增 {runtime.collectionRun?.newCount ?? 0} · 已保存{' '}
                {runtime.collectionRun?.savedCount ?? 0} · 列表{' '}
                {runtime.collectionRun?.visibleCount ?? 0}
              </p>
            ) : (
              <ProgressBar
                value={runtime?.detailRun?.completed ?? 0}
                maxValue={Math.max(1, runtime?.detailRun?.total ?? 0)}
              >
                <Label>详情已保存</Label>
                <ProgressBar.Output />
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
            )}
            {run.error && (
              <p className="text-sm text-danger" role="alert">
                {run.error}
              </p>
            )}
          </div>
        )}
        {runtime?.gatheringBusy && (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="secondary"
              isDisabled={disabled}
              onPress={() =>
                execute(run?.status === 'paused' ? 'resumeGathering' : 'pauseGathering')
              }
            >
              {run?.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
              {run?.status === 'paused' ? '继续' : '暂停'}
            </Button>
            <Button
              className="flex-1"
              variant="danger-soft"
              isDisabled={disabled}
              onPress={() => execute('stopGathering')}
            >
              <Square size={16} />
              停止采集
            </Button>
          </div>
        )}
        {runtime?.analysisRun && (
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="text-sm font-medium">
                AI 分析 · {statusNames[runtime.analysisRun.status] || runtime.analysisRun.status}
              </h3>
              {runtime.analysisBusy && (
                <Button
                  size="sm"
                  variant="danger-soft"
                  isDisabled={disabled}
                  onPress={() => execute('stopAnalysis')}
                >
                  <Square size={14} />
                  停止分析
                </Button>
              )}
            </div>
            <ProgressBar
              value={
                runtime.analysisRun.completed +
                runtime.analysisRun.failed +
                runtime.analysisRun.skipped
              }
              maxValue={Math.max(1, runtime.analysisRun.total)}
            >
              <Label>分析进度</Label>
              <ProgressBar.Output />
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
            <p className="text-xs text-muted">
              已保存 {runtime.analysisRun.completed} · 失败 {runtime.analysisRun.failed} · 跳过{' '}
              {runtime.analysisRun.skipped}
            </p>
            <p className="text-sm break-words">{runtime.analysisRun.currentJob}</p>
            {runtime.analysisRun.error && (
              <p className="text-sm text-danger" role="alert">
                {runtime.analysisRun.error}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3 border-t border-border pt-5">
        <h2 className="text-base font-semibold">当前配置</h2>
        <nav aria-label="当前配置" className="-mx-2 space-y-1 text-sm">
          <Link
            href="./workbench.html#resumes"
            target={compact ? '_blank' : undefined}
            rel={compact ? 'noreferrer' : undefined}
            className="flex w-full items-center justify-between gap-4 rounded-lg p-2 text-foreground no-underline transition-colors hover:bg-default/50"
          >
            <span className="shrink-0 text-muted">简历</span>
            <span className="flex min-w-0 items-center justify-end gap-2">
              <span className="min-w-0 text-right break-words">
                {state.resumes.resumes.find((resume) => resume.id === state.resumes.currentResumeId)
                  ?.name || '未选择'}
              </span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
            </span>
          </Link>
          <Link
            href="./workbench.html#models"
            target={compact ? '_blank' : undefined}
            rel={compact ? 'noreferrer' : undefined}
            className="flex w-full items-center justify-between gap-4 rounded-lg p-2 text-foreground no-underline transition-colors hover:bg-default/50"
          >
            <span className="shrink-0 text-muted">模型与提示词</span>
            <span className="flex min-w-0 items-center justify-end gap-2">
              <span className="min-w-0 text-right break-words">
                {state.models.find(
                  (model) =>
                    model.data?.api_key?.trim() &&
                    model.data.base_url?.trim() &&
                    model.data.model?.trim(),
                )?.name || '未配置'}
              </span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
            </span>
          </Link>
        </nav>
      </div>
      {!compact && runtime && (
        <div className="space-y-3 border-t border-border pt-5">
          <h2 className="text-base font-semibold">
            当前页面岗位 <span className="text-muted">{runtime.jobs.length}</span>
          </h2>
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="当前页面岗位">
                <Table.Header>
                  <Table.Column isRowHeader>岗位</Table.Column>
                  <Table.Column>公司</Table.Column>
                  <Table.Column>状态</Table.Column>
                  <Table.Column>操作</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <p className="p-8 text-center text-muted">当前列表暂无岗位</p>
                  )}
                >
                  {runtime.jobs.map((job) => (
                    <Table.Row key={job.key} id={job.key}>
                      <Table.Cell>
                        {job.jobName}
                        <span className="mt-1 block text-xs text-muted">{job.salary}</span>
                      </Table.Cell>
                      <Table.Cell>{job.brand.name}</Table.Cell>
                      <Table.Cell>
                        {statusNames[
                          runtime.results.find(([key]) => key === job.key)?.[1]?.status ?? 'pending'
                        ] || '待处理'}
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex gap-1">
                          <IconButton
                            label="在 BOSS 打开岗位"
                            disabled={startDisabled}
                            onPress={() => {
                              void act(() => command({ type: 'openJob', key: job.key }))
                            }}
                          >
                            <ExternalLink size={16} />
                          </IconButton>
                          <IconButton
                            label="保存岗位"
                            disabled={startDisabled}
                            onPress={() => {
                              void act(
                                () => command({ type: 'captureJob', key: job.key }),
                                '已保存岗位',
                              )
                            }}
                          >
                            <Save size={16} />
                          </IconButton>
                          <IconButton
                            label="分析岗位"
                            disabled={startDisabled}
                            onPress={() => {
                              void act(() =>
                                command({
                                  type: 'analyzeOne',
                                  jobId: job.key.slice('boss::'.length),
                                }),
                              )
                            }}
                          >
                            <WandSparkles size={16} />
                          </IconButton>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </div>
      )}
      {!compact && (
        <Accordion>
          <Accordion.Item id="history">
            <Accordion.Heading>
              <Accordion.Trigger>
                投递统计
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="w-44">
                    <SelectField
                      label="统计范围"
                      value={historyDays}
                      onChange={setHistoryDays}
                      options={[
                        { value: '3', label: '近三日' },
                        { value: '7', label: '近七日' },
                        { value: '30', label: '近三十日' },
                        { value: 'all', label: '全部历史' },
                      ]}
                    />
                  </div>
                  <p className="text-sm">
                    成功投递 {history.reduce((sum, day) => sum + day.success, 0)}
                  </p>
                </div>
                <Table variant="secondary">
                  <Table.ScrollContainer>
                    <Table.Content aria-label="历史投递统计">
                      <Table.Header>
                        <Table.Column isRowHeader>日期</Table.Column>
                        <Table.Column>扫描</Table.Column>
                        <Table.Column>成功</Table.Column>
                        <Table.Column>重复</Table.Column>
                        <Table.Column>活跃筛选</Table.Column>
                      </Table.Header>
                      <Table.Body
                        renderEmptyState={() => (
                          <p className="p-6 text-center text-muted">暂无统计</p>
                        )}
                      >
                        {history.map((day) => (
                          <Table.Row key={day.date} id={day.date}>
                            <Table.Cell>{day.date}</Table.Cell>
                            <Table.Cell>{day.total}</Table.Cell>
                            <Table.Cell>{day.success}</Table.Cell>
                            <Table.Cell>{day.repeat}</Table.Cell>
                            <Table.Cell>{day.activityFilter}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {!state.tabs.length && (
        <Alert>
          <Alert.Content>
            <Alert.Title>尚未连接 BOSS 岗位页</Alert.Title>
            <Alert.Description>本地岗位、简历和配置仍可在工作台查看。</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <ConfirmDialog
        open={deliveryConfirm}
        onClose={() => setDeliveryConfirm(false)}
        title="开始实时投递"
        confirmLabel="确认开始投递"
        disabled={state.saving}
        onConfirm={() => {
          void act(() => command({ type: 'startDelivery' })).then((ok) => {
            if (ok) setDeliveryConfirm(false)
          })
        }}
      >
        <p>将按当前筛选、简历及招呼语配置，向所选 BOSS 标签页的岗位发起真实沟通。</p>
      </ConfirmDialog>
    </section>
  )
}

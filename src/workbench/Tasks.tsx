/** @jsxImportSource react */
import {
  Accordion,
  Button,
  Chip,
  Label,
  Link,
  ListBox,
  ProgressBar,
  Select,
  Switch,
  TextArea,
  TextField,
} from '@heroui/react'
import {
  ArrowUp,
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
import { useEffect, useState } from 'react'

import { getJobFunnel } from '@/entrypoints/boss/jobStore'

import { ConfirmDialog, IconButton, act } from './components'
import { JobAI } from './JobAI'
import { SearchFilters } from './NativeFilters'
import type { ExecutorCommand } from './protocol'
import { statisticsHistory } from './statistics'
import { command, selectResume } from './store'
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

export function Tasks() {
  const state = useWorkbench()
  const runtime = state.runtime
  const [deliveryConfirm, setDeliveryConfirm] = useState(false)
  const [messageDraft, setMessageDraft] = useState<string | null>(null)
  useEffect(() => setMessageDraft(null), [runtime?.pendingMessage, state.tabId])
  const busy = !!(
    runtime?.gatheringBusy ||
    runtime?.analysisBusy ||
    runtime?.keywordRotationBusy ||
    runtime?.realtimeBusy ||
    runtime?.keywordExtractionBusy ||
    runtime?.keywordRotationSaving ||
    runtime?.workflow?.status === 'running'
  )
  const disabled = state.loading || state.saving
  const startDisabled = disabled || busy || !state.connected
  const funnel = getJobFunnel(state.records)
  const deliveredToday = statisticsHistory(state.today, state.statistics, 1)[0]?.success ?? 0
  const run = runtime?.gatheringKind === 'detail' ? runtime.detailRun : runtime?.collectionRun
  const rotation = runtime?.keywordRotation
  const rotationBusy = !!runtime?.keywordRotationBusy
  const rotationKeyword = rotation?.items[rotation.cursor]?.keyword
  const execute = (type: ExecutorCommand['type']) => {
    void act(() => command({ type } as ExecutorCommand))
  }

  return (
    <section className="space-y-6">
      <SearchFilters disabled={disabled || busy} />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">任务操作</h2>
          {busy && (
            <Chip size="sm" color="accent">
              运行中
            </Chip>
          )}
        </div>
        <Select
          aria-label="当前简历"
          value={state.resumes.currentResumeId ?? '__none__'}
          isDisabled={disabled || busy}
          fullWidth
          className="min-w-0"
          onChange={(key) => {
            const id = String(key ?? '__none__')
            void act(() => selectResume(id === '__none__' ? null : id), '当前简历已更新')
          }}
        >
          <Select.Trigger className="resume-select-trigger">
            <span className="shrink-0 text-sm">当前简历</span>
            <Select.Value className="min-w-0 flex-1 truncate text-right text-sm text-muted" />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {[{ id: '__none__', name: '不使用简历' }, ...state.resumes.resumes].map((resume) => (
                <ListBox.Item key={resume.id} id={resume.id} textValue={resume.name}>
                  <span className="min-w-0 break-words">{resume.name}</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="col-span-2"
            fullWidth
            variant={rotationBusy ? 'danger-soft' : 'primary'}
            isDisabled={
              rotationBusy
                ? disabled || !state.connected || !!runtime?.keywordRotationSaving
                : startDisabled || !state.keywords.trim()
            }
            onPress={() => execute(rotationBusy ? 'stopRotation' : 'rotate')}
          >
            {rotationBusy ? <Square size={16} /> : <ListRestart size={16} />}
            {rotationBusy
              ? '停止轮换'
              : rotation && ['paused', 'stopped', 'failed'].includes(rotation.status)
                ? '继续轮换'
                : '轮换采集并分析'}
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
        {runtime?.workflow?.status === 'stop' && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              isDisabled={disabled || busy}
              onPress={() => execute('resetDelivery')}
            >
              <RotateCcw size={14} />
              重置进度
            </Button>
          </div>
        )}
        <Switch
          className="switch-row"
          isSelected={runtime?.autoCaptureEnabled ?? false}
          isDisabled={disabled || !state.connected}
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
          <p className="text-sm text-muted break-words" aria-live="polite">
            {statusNames[rotation.status] || rotation.status}
            {rotationKeyword ? ` · 当前关键词：${rotationKeyword}` : ''}
          </p>
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
          <div className="space-y-3 pt-4">
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
        {runtime?.gatheringBusy && !rotationBusy && (
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
          <div className="space-y-2 pt-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="text-sm font-medium">
                AI 分析 · {statusNames[runtime.analysisRun.status] || runtime.analysisRun.status}
              </h3>
              {runtime.analysisBusy && !rotationBusy && (
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
      <nav aria-label="岗位统计入口" className="grid grid-cols-3 gap-2">
        {[
          { label: '已采集', count: funnel.collected, today: funnel.collectedToday, query: '' },
          {
            label: '已匹配',
            count: funnel.matched,
            today: funnel.matchedToday,
            query: '?stage=matched',
          },
          {
            label: '已投递',
            count: funnel.applied,
            today: deliveredToday,
            query: '?stage=applied',
          },
        ].map(({ label, count, today, query }) => (
          <Link
            key={label}
            href={`./workbench.html${query}#jobs`}
            target="_blank"
            rel="noreferrer"
            aria-label={`查看${label}岗位，共 ${count} 个`}
            className="workbench-nav-item flex w-full min-w-0 flex-wrap items-center gap-1 p-1"
          >
            <span className="text-xs text-muted">{label}</span>
            <span className="text-sm font-semibold tabular-nums break-all">{count}</span>
            {today > 0 && (
              <Chip
                size="sm"
                color="success"
                variant="soft"
                className="tabular-nums"
                aria-label={`今日${label.slice(1)} ${today} 个`}
                title={`今日${label.slice(1)} ${today} 个`}
              >
                <ArrowUp size={12} aria-hidden="true" />
                <Chip.Label>{today}</Chip.Label>
              </Chip>
            )}
          </Link>
        ))}
      </nav>
      {!!runtime?.pendingMessage?.trim() && (
        <Accordion>
          <Accordion.Item id="pending-message">
            <Accordion.Heading>
              <Accordion.Trigger>
                待发送消息
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="space-y-3">
                <TextField
                  value={messageDraft ?? runtime?.pendingMessage ?? ''}
                  onChange={setMessageDraft}
                  isDisabled={!state.connected || disabled}
                >
                  <Label>待发送消息草稿</Label>
                  <TextArea rows={4} />
                </TextField>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    isDisabled={!state.connected || disabled || messageDraft === null}
                    onPress={() => {
                      void act(
                        () => command({ type: 'setPendingMessage', value: messageDraft ?? '' }),
                        '草稿已保存',
                      ).then((ok) => {
                        if (ok) setMessageDraft(null)
                      })
                    }}
                  >
                    <Save size={16} />
                    保存草稿
                  </Button>
                </div>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      <div className="space-y-3 pt-5">
        <h2 className="text-base font-semibold">
          当前页面岗位{' '}
          <span className="text-muted">{state.connected ? (runtime?.jobs.length ?? 0) : '-'}</span>
        </h2>
        {!state.connected || !runtime?.jobs.length ? (
          <output className="block text-sm text-muted">
            {state.connected
              ? '当前列表暂无岗位'
              : state.tabId !== null && !state.connectionError && !runtime?.error
                ? '正在连接岗位页'
                : '连接 BOSS 标签页后查看'}
          </output>
        ) : (
          <ul aria-label="当前页面岗位" className="max-h-80 divide-y divide-border overflow-y-auto">
            {runtime.jobs.map((job) => (
              <li key={job.key} className="space-y-2 py-3">
                <p className="text-sm font-medium break-words">{job.jobName}</p>
                <p className="text-xs text-muted break-words">
                  {job.brand.name} · {job.salary}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {statusNames[
                      runtime.results.find(([key]) => key === job.key)?.[1]?.status ?? 'pending'
                    ] || '待处理'}
                  </span>
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
                        void act(() => command({ type: 'captureJob', key: job.key }), '已保存岗位')
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
                </div>
              </li>
            ))}
          </ul>
        )}
        <Accordion>
          <Accordion.Item id="job-ai">
            <Accordion.Heading>
              <Accordion.Trigger>
                AI 过程
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="max-h-96 overflow-y-auto">
                <JobAI />
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        <div className="flex items-center justify-between gap-2 pt-4">
          <h2 className="text-base font-semibold">最近运行</h2>
        </div>
        {runtime?.logs.length ? (
          <ul className="space-y-2 text-sm">
            {runtime.logs
              .slice(-3)
              .reverse()
              .map((log, index) => (
                <li key={index} className="break-words">
                  <Link
                    href="./workbench.html#logs"
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded px-2 py-1 hover:bg-default"
                  >
                    <span className={log.state === 'danger' ? 'text-danger' : 'text-muted'}>
                      {log.state_name}
                    </span>{' '}
                    {log.title}
                  </Link>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            {state.connected ? '暂无运行记录' : '连接 BOSS 标签页后查看'}
          </p>
        )}
      </div>
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

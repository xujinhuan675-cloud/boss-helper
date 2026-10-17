/** @jsxImportSource react */
import { Alert, Button, Chip, Label, Link, ProgressBar, Switch } from '@heroui/react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
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

import { isCompleteModel } from '@/composables/useModel'
import { getJobFunnel } from '@/entrypoints/boss/jobStore'

import { ConfirmDialog, IconButton, SelectField, act } from './components'
import type { ExecutorCommand } from './protocol'
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
  const [configExpanded, setConfigExpanded] = useState(true)
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
  const availableModels = state.models.filter(isCompleteModel)
  const funnel = getJobFunnel(state.records)
  const run = runtime?.gatheringKind === 'detail' ? runtime.detailRun : runtime?.collectionRun
  const rotation = runtime?.keywordRotation
  const execute = (type: ExecutorCommand['type']) => {
    void act(() => command({ type } as ExecutorCommand))
  }

  return (
    <section className="space-y-6">
      <nav
        aria-label="岗位统计入口"
        className="grid grid-cols-2 gap-x-4 gap-y-5 border-b border-border pb-5"
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
            target="_blank"
            rel="noreferrer"
            aria-label={`查看${label}岗位，共 ${count} 个`}
            className="workbench-nav-item block w-full min-w-0 p-2"
          >
            <span className="flex items-center justify-between gap-2 text-sm text-muted">
              {label}
              <ArrowUpRight size={15} aria-hidden="true" className="shrink-0" />
            </span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums">{count}</span>
          </Link>
        ))}
      </nav>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">任务操作</h2>
          <Chip size="sm" color={busy ? 'accent' : 'default'}>
            {!state.connected ? '未连接' : busy ? '运行中' : '待命'}
          </Chip>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Button
            fullWidth
            variant="primary"
            isDisabled={startDisabled || !state.keywords.trim()}
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
        <h2 className="text-base font-semibold">
          当前页面岗位{' '}
          <span className="text-muted">{state.connected ? (runtime?.jobs.length ?? 0) : '-'}</span>
        </h2>
        {!state.connected || !runtime?.jobs.length ? (
          <output className="flex min-h-20 items-center text-sm text-muted">
            {state.connected
              ? '当前列表暂无岗位'
              : state.tabId !== null && !state.connectionError && !runtime?.error
                ? '正在连接岗位页'
                : '尚未连接 BOSS 岗位页'}
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
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <div>
            <h2 className="text-base font-semibold">最近运行</h2>
            <p className="mt-1 text-xs text-muted">显示采集、分析、投递等最近事件</p>
          </div>
          <Link href="./workbench.html#logs" target="_blank" rel="noreferrer" className="text-sm">
            查看日志 <ArrowUpRight size={14} />
          </Link>
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
            {state.connected ? '暂无运行记录' : '尚未连接岗位页'}
          </p>
        )}
      </div>
      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">当前配置</h2>
          <IconButton
            label={configExpanded ? '收起当前配置' : '展开当前配置'}
            onPress={() => setConfigExpanded((expanded) => !expanded)}
          >
            {configExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </IconButton>
        </div>
        {configExpanded && (
          <>
            <SelectField
              label="当前简历"
              value={state.resumes.currentResumeId ?? '__none__'}
              options={[
                { value: '__none__', label: '不使用简历' },
                ...state.resumes.resumes.map((resume) => ({
                  value: resume.id,
                  label: resume.name,
                })),
              ]}
              disabled={disabled || busy}
              onChange={(id) => {
                void act(() => selectResume(id === '__none__' ? null : id), '当前简历已更新')
              }}
            />
            <nav aria-label="当前配置" className="-mx-3 space-y-1 text-sm">
              {[
                {
                  id: 'models',
                  label: '模型与提示词',
                  value: availableModels[0]?.name || '未配置',
                },
                { id: 'filters', label: '岗位筛选', value: '' },
                { id: 'settings', label: '任务设置', value: '' },
              ].map(({ id, label, value }) => (
                <Link
                  key={id}
                  href={`./workbench.html#${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="workbench-nav-item flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2.5"
                >
                  <span className="shrink-0">{label}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-muted">{value}</span>
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  </span>
                </Link>
              ))}
            </nav>
          </>
        )}
      </div>
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

/** @jsxImportSource react */
import { Accordion, Alert, Button, Chip } from '@heroui/react'
import { Copy, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { browser } from '#imports'
import { formatFilteringMessage } from '@/composables/useApplying/scoring'

import {
  clearSavedDiagnostics,
  DIAGNOSTICS_MIRROR_KEY,
  syncDiagnosticMirror,
} from '../message/diagnostics'
import type { DiagnosticMirrorStatus } from '../message/diagnostics'
import {
  getDiagnostics,
  hasDiagnosticStorageError,
  subscribeDiagnostics,
} from '../utils/diagnostics'
import { ConfirmDialog, IconButton, SelectField, act } from './components'
import { command, selectChat } from './store'
import { useWorkbench } from './useWorkbench'

function DiagnosticAccess() {
  const [status, setStatus] = useState<DiagnosticMirrorStatus>()
  const [syncing, setSyncing] = useState(false)
  useEffect(() => {
    let active = true
    let changed = false
    const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && DIAGNOSTICS_MIRROR_KEY in changes) {
        changed = true
        setStatus(changes[DIAGNOSTICS_MIRROR_KEY]?.newValue as DiagnosticMirrorStatus)
      }
    }
    browser.storage.onChanged.addListener(onChange)
    void browser.storage.local
      .get(DIAGNOSTICS_MIRROR_KEY)
      .then((data) => {
        if (active && !changed) setStatus(data[DIAGNOSTICS_MIRROR_KEY] as DiagnosticMirrorStatus)
      })
      .catch(() => {
        if (active) setStatus({ ok: false, error: '无法读取本机同步状态' })
      })
    return () => {
      active = false
      browser.storage.onChanged.removeListener(onChange)
    }
  }, [])
  const readCommand = 'npm run diagnostics:read'
  return (
    <div className="space-y-2 border-b border-border pb-4 text-sm" aria-label="AI 诊断日志访问">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">AI 诊断日志访问</h3>
        <IconButton
          label="同步诊断到本机"
          disabled={syncing}
          onPress={() => {
            setSyncing(true)
            void syncDiagnosticMirror()
              .then(setStatus)
              .catch(() => setStatus({ ok: false, error: '后台连接失败，请重新打开工作台' }))
              .finally(() => setSyncing(false))
          }}
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
        </IconButton>
      </div>
      <output className="block text-muted">
        {syncing
          ? '正在同步'
          : status?.ok
            ? `已同步 · ${new Date(status.exportedAt!).toLocaleString()}`
            : '本机日志镜像未连接'}
      </output>
      {status?.ok && <p className="break-all font-mono text-xs">{status.path}</p>}
      {status?.error && <p className="break-words text-warning">{status.error}</p>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 break-all text-xs">{readCommand}</code>
        <IconButton
          label="复制诊断读取命令"
          onPress={() => void act(() => navigator.clipboard.writeText(readCommand))}
        >
          <Copy size={14} />
        </IconButton>
      </div>
      <details className="text-muted">
        <summary className="cursor-pointer">访问方式与连接配置</summary>
        <div className="mt-2 space-y-2 break-words">
          <p>
            本机 AI 可在项目根目录执行读取命令，或直接读取
            %LOCALAPPDATA%\OfferHunt\diagnostics\latest.json。
          </p>
          <p>
            首次连接（Windows Chrome，Node.js 22.18+）：在项目根目录执行{' '}
            <code>npm run diagnostics:install</code>，重载扩展后自动同步。
          </p>
          <p>
            镜像保留最近 200
            条脱敏诊断；清空诊断时同步清空。未连接时旧镜像保留，恢复连接后更新。镜像不包含原始模型请求、简历或岗位全文。
          </p>
          <p>FlowGuide 当前不能直接读取其他扩展页面，现有本机诊断接口尚未支持 OfferHunt。</p>
        </div>
      </details>
    </div>
  )
}

export function Logs() {
  const state = useWorkbench()
  const runtime = state.runtime
  const [kind, setKind] = useState('runtime')
  const [filter, setFilter] = useState('all')
  const [clear, setClear] = useState(false)
  const diagnostics = useSyncExternalStore(subscribeDiagnostics, getDiagnostics)
  const diagnosticStorageError = useSyncExternalStore(
    subscribeDiagnostics,
    hasDiagnosticStorageError,
  )
  const logs = runtime?.logs.filter((log) => filter === 'all' || log.state === filter) ?? []
  const filteredDiagnostics = diagnostics.filter(
    (event) => filter === 'all' || event.level === filter,
  )
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">运行日志</h1>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-48 max-w-full">
            <SelectField
              label="记录类型"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'runtime', label: '运行记录' },
                { value: 'diagnostics', label: '诊断事件' },
                { value: 'chat', label: 'AI 对话' },
              ]}
            />
          </div>
          <div className="w-48 max-w-full">
            <SelectField
              label="日志级别"
              value={filter}
              disabled={kind === 'chat'}
              onChange={setFilter}
              options={[
                { value: 'all', label: '全部' },
                ...(kind === 'runtime'
                  ? [
                      { value: 'info', label: '信息' },
                      { value: 'success', label: '成功' },
                      { value: 'warning', label: '过滤' },
                      { value: 'danger', label: '错误' },
                    ]
                  : [
                      { value: 'info', label: '信息' },
                      { value: 'warning', label: '警告' },
                      { value: 'error', label: '错误' },
                    ]),
              ]}
            />
          </div>
          <Button
            size="sm"
            variant="danger-soft"
            isDisabled={
              state.saving ||
              (kind === 'runtime'
                ? !state.connected || !runtime?.logs.length
                : kind === 'diagnostics'
                  ? !diagnostics.length
                  : !runtime?.chatJobKey || !runtime.messages?.length)
            }
            onPress={() => setClear(true)}
          >
            <Trash2 size={15} />
            清空
          </Button>
        </div>
      </div>
      {kind === 'diagnostics' && (
        <div className="space-y-3 border-b border-border pb-5">
          <DiagnosticAccess />
          {diagnosticStorageError && (
            <p role="alert" className="text-sm text-danger">
              诊断保存失败，当前记录未写入本机存储；关闭此页可能丢失未保存记录。
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">诊断事件 · {diagnostics.length}</h2>
            {!filteredDiagnostics.length && <p className="py-4 text-sm text-muted">暂无诊断事件</p>}
          </div>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {[...filteredDiagnostics].reverse().map((event) => (
              <details key={event.id} className="border-b border-border py-2 text-sm">
                <summary className="cursor-pointer break-words">
                  <span className={event.level === 'error' ? 'text-danger' : 'text-muted'}>
                    {event.level === 'error' ? '错误' : event.level === 'warning' ? '警告' : '完成'}
                  </span>{' '}
                  <time>{new Date(event.time).toLocaleTimeString()}</time> {event.source} ·{' '}
                  {event.operation}
                  {event.durationMs !== undefined && (
                    <span className="text-muted"> · {Math.round(event.durationMs)} ms</span>
                  )}
                  {event.error && <p className="mt-1 break-words text-danger">{event.error}</p>}
                </summary>
                <p className="mt-2 break-all text-xs text-muted">{event.id}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(event.context, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </div>
      )}
      {kind === 'runtime' && !state.connected && (
        <Alert>
          <Alert.Content>
            <Alert.Title>连接 BOSS 标签页后查看运行记录</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      {state.connected && kind === 'chat' && (
        <details className="border-b border-border pb-4" aria-label="AI 过程">
          <summary className="cursor-pointer text-base font-semibold">AI 过程</summary>
          <div className="mt-4 space-y-4">
            <SelectField
              label="岗位对话"
              value={runtime?.chatJobKey || 'none'}
              disabled={!runtime?.chatJobs?.length}
              options={
                runtime?.chatJobs?.length
                  ? runtime.chatJobs.map((key) => {
                      const job = runtime.jobs.find((item) => item.key === key)
                      return {
                        value: key,
                        label: job ? `${job.jobName} · ${job.brand?.name || key}` : key,
                      }
                    })
                  : [{ value: 'none', label: '暂无对话' }]
              }
              onChange={selectChat}
            />
            {!runtime?.messages?.length && (
              <p className="py-4 text-sm text-muted">暂无岗位 AI 消息</p>
            )}
            <div className="max-h-[32rem] space-y-4 overflow-y-auto">
              {runtime?.messages?.map((message, index) => (
                <article
                  key={message.id || index}
                  className="space-y-3 border-b border-border pb-4"
                >
                  <Chip size="sm">
                    {message.role === 'assistant'
                      ? 'AI'
                      : message.role === 'user'
                        ? '用户'
                        : '系统'}{' '}
                    ·{' '}
                    {{
                      system: '系统规则',
                      user: '用户输入',
                      assistant: '模型回复',
                      boss: '招聘者消息',
                      jd: '岗位描述',
                      filtering: '岗位匹配',
                      greetings: '招呼语生成',
                      keywords: '关键词提取',
                    }[message.uiRole] || message.uiRole}
                  </Chip>
                  {message.parts?.map((part, i) =>
                    part.type === 'text' ? (
                      <p key={i} className="whitespace-pre-wrap break-words text-sm">
                        {message.uiRole === 'filtering'
                          ? formatFilteringMessage(part.text)
                          : part.text}
                      </p>
                    ) : part.type === 'reasoning' ? (
                      <details key={i} className="text-sm text-muted">
                        <summary className="cursor-pointer">思考过程</summary>
                        <p className="mt-2 whitespace-pre-wrap break-words">{part.text}</p>
                      </details>
                    ) : (
                      <p key={i} className="text-xs text-muted">
                        {part.type}
                      </p>
                    ),
                  )}
                </article>
              ))}
            </div>
          </div>
        </details>
      )}
      {kind === 'runtime' && (
        <div className="space-y-4">
          {!logs.length && <p className="py-12 text-center text-sm text-muted">暂无日志</p>}
          <Accordion>
            {logs.map((log, index) => (
              <Accordion.Item key={index} id={String(index)}>
                <Accordion.Heading>
                  <Accordion.Trigger>
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <Chip
                        size="sm"
                        color={
                          log.state === 'danger'
                            ? 'danger'
                            : log.state === 'success'
                              ? 'success'
                              : log.state === 'warning'
                                ? 'warning'
                                : 'default'
                        }
                      >
                        {log.state_name}
                      </Chip>
                      <span className="min-w-0 break-words text-left">{log.title}</span>
                    </span>
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="space-y-3">
                    <p className="whitespace-pre-wrap text-sm">
                      {log.message || log.data?.message}
                    </p>
                    {Object.entries(log.data ?? {})
                      .filter(
                        ([key, value]) =>
                          key !== 'message' &&
                          value !== null &&
                          value !== undefined &&
                          value !== '',
                      )
                      .map(([key, value]) => (
                        <div key={key}>
                          <p className="mb-1 text-xs text-muted">
                            {{
                              state: '状态',
                              err: '错误',
                              aiFilteringQ: '筛选请求',
                              aiFilteringR: '筛选思考',
                              aiFilteringAjson: '筛选结果',
                              aiFilteringAtext: '筛选回复',
                              aiGreetingQ: '招呼语请求',
                              aiGreetingR: '招呼语思考',
                              aiGreetingA: '招呼语结果',
                            }[key] || key}
                          </p>
                          <pre className="text-sm">
                            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                          </pre>
                        </div>
                      ))}
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </div>
      )}
      <ConfirmDialog
        open={clear}
        title={
          kind === 'runtime'
            ? '清空运行日志'
            : kind === 'diagnostics'
              ? '清空诊断事件'
              : '清空岗位 AI 对话'
        }
        onClose={() => setClear(false)}
        danger
        disabled={state.saving}
        onConfirm={() => {
          const clearCurrent =
            kind === 'runtime'
              ? () => command({ type: 'clearLogs' })
              : kind === 'diagnostics'
                ? clearSavedDiagnostics
                : () => command({ type: 'clearChat', key: runtime!.chatJobKey! })
          void act(clearCurrent).then((ok) => {
            if (ok) setClear(false)
          })
        }}
      >
        <p>
          {kind === 'runtime'
            ? '这会清空所选 BOSS 标签页本次运行的日志。'
            : kind === 'diagnostics'
              ? '这会清空扩展保存的诊断事件，并在本机通道连接时同步清空镜像。'
              : '这会清空当前选中岗位的 AI 对话，不影响其他岗位。'}
        </p>
      </ConfirmDialog>
    </section>
  )
}

/** @jsxImportSource react */
import { Accordion, Alert, Button, Chip } from '@heroui/react'
import { Download, Trash2 } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'

import { clearSavedDiagnostics } from '../message/diagnostics'
import {
  getDiagnostics,
  hasDiagnosticStorageError,
  subscribeDiagnostics,
} from '../utils/diagnostics'
import { exportJson } from '../utils/jsonImportExport'
import { ConfirmDialog, IconButton, SelectField, act } from './components'
import { command } from './store'
import { useWorkbench } from './useWorkbench'

export function Logs() {
  const state = useWorkbench()
  const runtime = state.runtime
  const [filter, setFilter] = useState('all')
  const [clear, setClear] = useState(false)
  const [clearDiagnostic, setClearDiagnostic] = useState(false)
  const diagnostics = useSyncExternalStore(subscribeDiagnostics, getDiagnostics)
  const diagnosticStorageError = useSyncExternalStore(
    subscribeDiagnostics,
    hasDiagnosticStorageError,
  )
  const logs = runtime?.logs.filter((log) => filter === 'all' || log.state === filter) ?? []
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">运行日志</h1>
      </div>
      <div className="space-y-3 border-b border-border pb-5">
        {diagnosticStorageError && (
          <p role="alert" className="text-sm text-danger">
            诊断保存失败，当前记录仍可导出；关闭此页可能丢失未保存记录。
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            运行诊断 <span className="font-normal text-muted">{diagnostics.length}</span>
          </h2>
          <div className="flex items-center gap-1">
            <IconButton
              label="导出诊断"
              disabled={!diagnostics.length}
              onPress={() =>
                exportJson(
                  { version: import.meta.env.VITE_VERSION, events: diagnostics },
                  'OfferHunt-diagnostics',
                )
              }
            >
              <Download size={16} />
            </IconButton>
            <IconButton
              label="清空诊断"
              disabled={!diagnostics.length || state.saving}
              onPress={() => setClearDiagnostic(true)}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>
        {!diagnostics.length && <p className="py-4 text-sm text-muted">暂无诊断记录</p>}
        <div className="max-h-[32rem] space-y-2 overflow-y-auto">
          {[...diagnostics].reverse().map((event) => (
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
      {!state.connected && (
        <Alert>
          <Alert.Content>
            <Alert.Title>连接 BOSS 标签页后查看运行记录</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-end gap-4">
          <Button
            size="sm"
            variant="danger-soft"
            isDisabled={!state.connected || state.saving || !runtime?.logs.length}
            onPress={() => setClear(true)}
          >
            <Trash2 size={15} />
            清空
          </Button>
          <div className="w-48 max-w-full">
            <SelectField
              label="日志级别"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'info', label: '信息' },
                { value: 'success', label: '成功' },
                { value: 'warning', label: '过滤' },
                { value: 'danger', label: '错误' },
              ]}
            />
          </div>
        </div>
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
                  <p className="whitespace-pre-wrap text-sm">{log.message || log.data?.message}</p>
                  {Object.entries(log.data ?? {})
                    .filter(
                      ([key, value]) =>
                        key !== 'message' && value !== null && value !== undefined && value !== '',
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
      <ConfirmDialog
        open={clearDiagnostic}
        title="清空诊断记录"
        onClose={() => setClearDiagnostic(false)}
        danger
        disabled={state.saving}
        onConfirm={() => {
          void act(clearSavedDiagnostics).then((ok) => {
            if (ok) setClearDiagnostic(false)
          })
        }}
      >
        <p>清空扩展本地保存的运行诊断。</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={clear}
        title="清空本页运行日志"
        onClose={() => setClear(false)}
        danger
        disabled={state.saving}
        onConfirm={() => {
          void act(() => command({ type: 'clearLogs' })).then((ok) => {
            if (ok) setClear(false)
          })
        }}
      >
        <p>这会清空所选 BOSS 标签页本次运行的日志。</p>
      </ConfirmDialog>
    </section>
  )
}

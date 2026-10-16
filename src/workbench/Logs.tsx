/** @jsxImportSource react */
import {
  Accordion,
  Alert,
  Button,
  Chip,
  Label,
  Switch,
  Tabs,
  TextArea,
  TextField,
} from '@heroui/react'
import { Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatFilteringMessage } from '@/composables/useApplying/scoring'

import { ConfirmDialog, SelectField, act } from './components'
import { command, selectChat } from './store'
import { useWorkbench } from './useWorkbench'

export function Logs() {
  const state = useWorkbench()
  const runtime = state.runtime
  const [filter, setFilter] = useState('all')
  const [clear, setClear] = useState(false)
  const [following, setFollowing] = useState(true)
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    if (following && runtime?.currentJob) selectChat(runtime.currentJob)
  }, [following, runtime?.currentJob])
  const logs = runtime?.logs.filter((log) => filter === 'all' || log.state === filter) ?? []
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">运行日志</h1>
      </div>
      {!state.connected && (
        <Alert>
          <Alert.Content>
            <Alert.Title>连接 BOSS 标签页后查看运行记录</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      <Tabs defaultSelectedKey="logs">
        <Tabs.ListContainer>
          <Tabs.List aria-label="运行记录">
            <Tabs.Tab id="logs">
              日志
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="chat">
              AI 对话
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="logs" className="space-y-4 pt-5">
          <div className="flex items-end justify-between gap-4">
            <div className="w-48">
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
            <Button
              size="sm"
              variant="danger-soft"
              isDisabled={!state.connected || state.saving || !runtime?.logs.length}
              onPress={() => setClear(true)}
            >
              <Trash2 size={15} />
              清空
            </Button>
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
        </Tabs.Panel>
        <Tabs.Panel id="chat" className="space-y-5 pt-5">
          <div className="field-grid">
            <SelectField
              label="岗位对话"
              value={runtime?.chatJobKey || 'none'}
              disabled={!runtime?.chatJobs.length}
              options={
                runtime?.chatJobs.length
                  ? runtime.chatJobs.map((key) => ({
                      value: key,
                      label: runtime.jobs.find((job) => job.key === key)?.jobName || key,
                    }))
                  : [{ value: 'none', label: '暂无对话' }]
              }
              onChange={(key) => {
                setFollowing(false)
                selectChat(key)
              }}
            />
            <Switch isSelected={following} onChange={setFollowing}>
              <Switch.Content>
                <Label>跟随当前任务</Label>
              </Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
          {!runtime?.messages.length && (
            <p className="py-12 text-center text-sm text-muted">暂无 AI 对话</p>
          )}
          {runtime?.messages.map((message, index) => (
            <article key={message.id || index} className="space-y-3 border-b border-border pb-5">
              <Chip size="sm">
                {message.role === 'assistant' ? 'AI' : message.role === 'user' ? '用户' : '系统'} ·{' '}
                {message.uiRole}
              </Chip>
              {message.parts?.map((part, i) =>
                part.type === 'text' ? (
                  <p key={i} className="whitespace-pre-wrap break-words text-sm">
                    {message.uiRole === 'filtering' ? formatFilteringMessage(part.text) : part.text}
                  </p>
                ) : part.type === 'reasoning' ? (
                  <Accordion key={i}>
                    <Accordion.Item>
                      <Accordion.Heading>
                        <Accordion.Trigger>
                          思考过程
                          <Accordion.Indicator />
                        </Accordion.Trigger>
                      </Accordion.Heading>
                      <Accordion.Panel>
                        <Accordion.Body>
                          <p className="whitespace-pre-wrap break-words text-sm text-muted">
                            {part.text}
                          </p>
                        </Accordion.Body>
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                ) : (
                  <p key={i} className="text-xs text-muted">
                    {part.type}
                  </p>
                ),
              )}
            </article>
          ))}
          <TextField value={draft ?? runtime?.pendingMessage ?? ''} onChange={setDraft}>
            <Label>补充消息草稿</Label>
            <TextArea rows={4} />
          </TextField>
          <Button
            variant="secondary"
            isDisabled={!state.connected || state.saving || draft === null}
            onPress={() => {
              void act(
                () => command({ type: 'setPendingMessage', value: draft ?? '' }),
                '草稿已保存',
              ).then((ok) => {
                if (ok) setDraft(null)
              })
            }}
          >
            <Save size={16} />
            保存草稿
          </Button>
        </Tabs.Panel>
      </Tabs>
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

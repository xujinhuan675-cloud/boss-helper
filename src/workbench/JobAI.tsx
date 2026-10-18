/** @jsxImportSource react */
import { Accordion, Alert, Chip, Label, Switch } from '@heroui/react'
import { useEffect, useState } from 'react'

import { formatFilteringMessage } from '@/composables/useApplying/scoring'

import { SelectField } from './components'
import { selectChat } from './store'
import { useWorkbench } from './useWorkbench'

export function JobAI() {
  const state = useWorkbench()
  const runtime = state.runtime
  const [following, setFollowing] = useState(true)
  useEffect(() => {
    if (following && runtime?.currentJob) selectChat(runtime.currentJob)
  }, [following, runtime?.currentJob])

  return (
    <div className="space-y-5">
      {!state.connected && (
        <Alert>
          <Alert.Content>
            <Alert.Title>连接 BOSS 标签页后查看岗位 AI 过程</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      <div className="field-grid">
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
          onChange={(key) => {
            setFollowing(false)
            selectChat(key)
          }}
        />
        <Switch
          aria-label="跟随当前任务"
          className="switch-row"
          isSelected={following}
          onChange={setFollowing}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <Label>跟随当前任务</Label>
          </Switch.Content>
        </Switch>
      </div>
      {!runtime?.messages?.length && (
        <p className="py-4 text-center text-sm text-muted">暂无岗位 AI 消息</p>
      )}
      {runtime?.messages?.map((message, index) => (
        <article key={message.id || index} className="space-y-3 border-b border-border pb-5">
          <Chip size="sm">
            {message.role === 'assistant' ? 'AI' : message.role === 'user' ? '用户' : '系统'} ·{' '}
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
    </div>
  )
}

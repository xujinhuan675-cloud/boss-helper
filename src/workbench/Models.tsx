/** @jsxImportSource react */
import {
  Alert,
  Button,
  Chip,
  Input,
  Label,
  NumberField,
  Separator,
  Switch,
  Table,
  Tabs,
  TextArea,
  TextField,
} from '@heroui/react'
import {
  ArrowUp,
  Copy,
  ListRestart,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { defaultFormData } from '@/composables/conf/info'
import { MATCH_SCORING_VERSION, validateMatchThreshold } from '@/composables/useApplying/scoring'
import { isCompleteModel } from '@/composables/useModel'
import type { ModelConf } from '@/composables/useModel'
import { selectAvailableModel, testModelConnection } from '@/composables/useModel/connection'
import type { ModelConnectionResult } from '@/composables/useModel/connection'
import type { OpenaiLLMConf } from '@/composables/useModel/openai'
import { counter } from '@/message'
import type { FormData, Prompt } from '@/types/formData'
import { jsonClone } from '@/utils/deepmerge'

import { diagnostic } from '../utils/diagnostics'
import { act, ConfirmDialog, IconButton, SelectField } from './components'
import { CustomGreeting } from './CustomGreeting'
import { validateModels } from './settingsValidation'
import { saveConfig, saveModels, selectDefaultModel, services } from './store'
import { useWorkbench } from './useWorkbench'

type PromptKey = 'aiFiltering' | 'aiGreeting' | 'aiReply'
const promptLabels: Record<PromptKey, string> = {
  aiFiltering: '岗位匹配',
  aiGreeting: 'AI 招呼语',
  aiReply: '回复提示词',
}
const messageLabels = { system: '系统规则', user: '输入模板', assistant: '示例回复' }

async function modelOptionsStorageKey(baseUrl: string, apiKey: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([baseUrl, apiKey])),
  )
  return `local:boss-helper:model-options:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`
}

async function fetchModelsThroughBackground(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const { signal: _signal, ...data } = init ?? {}
  const result = await counter.fetchText({
    url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    data: { ...data, headers: Object.fromEntries(headers.entries()) },
    timeout: 10000,
  })
  return new Response(result.text, { status: result.status })
}

export function Models() {
  const state = useWorkbench()
  const [editor, setEditor] = useState<ModelConf | null>(null)
  const [deleting, setDeleting] = useState<ModelConf | null>(null)
  const [promptDrafts, setPromptDrafts] = useState<Partial<Pick<FormData, PromptKey>>>({})
  const [selectedMessages, setSelectedMessages] = useState<Partial<Record<PromptKey, number>>>({})
  const [greetingDraft, setGreetingDraft] = useState<
    Partial<Pick<FormData, 'customGreeting' | 'greetingVariable'>>
  >({})
  const promptPresets = useRef<Partial<Record<PromptKey, string>>>({})
  const [testing, setTesting] = useState(false)
  const testingRef = useRef(false)
  const [connection, setConnection] = useState<ModelConnectionResult | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const optionsRevision = useRef(0)
  const [error, setError] = useState('')
  const runtime = state.runtime
  const busy =
    state.loading ||
    state.saving ||
    !!(
      runtime?.gatheringBusy ||
      runtime?.analysisBusy ||
      runtime?.keywordRotationBusy ||
      runtime?.realtimeBusy ||
      runtime?.keywordExtractionBusy ||
      runtime?.keywordRotationSaving ||
      runtime?.workflow?.status === 'running'
    )
  const defaultKey = state.models.find(isCompleteModel)?.key ?? state.models[0]?.key
  const selectedModel = editor?.data?.model
  const modelIds =
    selectedModel && !availableModels.includes(selectedModel)
      ? [selectedModel, ...availableModels]
      : availableModels
  const editorKey = editor?.key
  const baseUrl = editor?.data?.base_url ?? ''
  const apiKey = editor?.data?.api_key ?? ''
  useEffect(() => {
    let active = true
    const revision = ++optionsRevision.current
    setAvailableModels([])
    if (!editorKey) return
    void (async () => {
      try {
        const key = await modelOptionsStorageKey(baseUrl, apiKey)
        const models = await counter.storageGet<unknown>(key, [])
        if (
          active &&
          revision === optionsRevision.current &&
          Array.isArray(models) &&
          models.every((id) => typeof id === 'string' && !!id.trim())
        )
          setAvailableModels([...new Set(models)])
      } catch (error) {
        if (active && revision === optionsRevision.current)
          setError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      active = false
    }
  }, [editorKey, baseUrl, apiKey])

  function edit(model?: ModelConf) {
    if (busy || testingRef.current) return
    const draft = jsonClone<ModelConf>(
      model ?? {
        key: crypto.randomUUID(),
        name: '',
        data: {
          mode: 'openai',
          base_url: '',
          api_key: '',
          model: '',
        },
      },
    )
    setEditor(draft)
    setConnection(null)
    setError('')
  }

  function changeData(patch: Partial<OpenaiLLMConf>) {
    if (!editor) return
    setEditor({
      ...editor,
      data: { mode: 'openai', ...editor.data, ...patch } as OpenaiLLMConf,
    })
    setConnection(null)
  }

  function modelSnapshot(): ModelConf {
    if (!editor) throw new Error('请先选择模型')
    const next = jsonClone(editor)
    validateModels([next])
    return next
  }

  async function save() {
    if (busy || testingRef.current || !editor) return
    setError('')
    try {
      const next = modelSnapshot()
      if (
        await act(
          () =>
            saveModels((latest) =>
              latest.some((model) => model.key === next.key)
                ? latest.map((model) => (model.key === next.key ? next : model))
                : [...latest, next],
            ),
          '模型已保存',
        )
      )
        setEditor(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  async function testConnection(select = false) {
    if (busy || testingRef.current || !editor) return
    setError('')
    setConnection(null)
    let next: ModelConf
    try {
      next = modelSnapshot()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return
    }
    testingRef.current = true
    setTesting(true)
    const started = performance.now()
    try {
      const result = await testModelConnection(next.data!, fetchModelsThroughBackground)
      diagnostic('model.connection', {
        level: result.status === 'connected' ? 'info' : 'error',
        durationMs: performance.now() - started,
        context: {
          status: result.status,
          statusCode: result.httpStatus,
          endpoint: next.data?.base_url,
        },
      })
      setConnection(result)
      if (select && result.status === 'connected' && result.models) {
        ++optionsRevision.current
        setAvailableModels(result.models)
        setEditor((current) =>
          current
            ? {
                ...current,
                data: {
                  ...current.data!,
                  model: selectAvailableModel(current.data?.model ?? '', result.models!),
                },
              }
            : current,
        )
        const key = await modelOptionsStorageKey(next.data!.base_url, next.data!.api_key)
        await counter.storageSet(key, result.models)
      }
    } catch (error) {
      diagnostic('model.connection', {
        error,
        durationMs: performance.now() - started,
        context: { endpoint: next.data?.base_url },
      })
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      testingRef.current = false
      setTesting(false)
    }
  }

  function changePrompt(key: PromptKey, patch: Partial<FormData[PromptKey]>) {
    promptPresets.current[key] ??= state.preset
    setPromptDrafts((drafts) => ({
      ...drafts,
      [key]: { ...(drafts[key] ?? state.config[key]), ...patch },
    }))
  }

  function discardPrompt(key: PromptKey) {
    if (key === 'aiGreeting') setGreetingDraft({})
    delete promptPresets.current[key]
    setPromptDrafts((drafts) => {
      const next = { ...drafts }
      delete next[key]
      return next
    })
  }

  async function savePrompt(key: PromptKey) {
    if (busy) return
    const draft = promptDrafts[key]
    if (!draft) return
    setError('')
    try {
      if (key === 'aiFiltering') validateMatchThreshold((draft as FormData['aiFiltering']).score)
      const value =
        key === 'aiFiltering' ? { ...draft, scoringVersion: MATCH_SCORING_VERSION } : draft
      if (
        await act(
          () => {
            if (promptPresets.current[key] !== services.conf.formDataPreset.value)
              throw new Error('配置预设已变更，请先放弃提示词草稿并重新加载当前预设')
            return saveConfig({ [key]: value, ...(key === 'aiGreeting' ? greetingDraft : {}) })
          },
          key === 'aiGreeting' ? '招呼语已保存' : '提示词已保存',
        )
      )
        discardPrompt(key)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="models-page flex flex-col gap-6">
      <h1 className="text-xl font-semibold">模型与提示词</h1>
      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>操作未完成</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <Tabs defaultSelectedKey="model-configuration" className="models-sections">
        <Tabs.ListContainer>
          <Tabs.List aria-label="模型与提示词设置">
            <Tabs.Tab id="model-configuration">
              模型配置
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="prompt-configuration">
              提示词
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="model-configuration" className="flex flex-col gap-5 pt-5">
          <div className="flex justify-end">
            <Button isDisabled={busy || testing} onPress={() => edit()}>
              <Plus size={16} />
              新建模型
            </Button>
          </div>
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="AI 模型">
                <Table.Header>
                  <Table.Column isRowHeader>模型</Table.Column>
                  <Table.Column>API 地址</Table.Column>
                  <Table.Column className="text-right">管理</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => <p className="p-4 text-sm text-muted">尚未配置模型</p>}
                >
                  {state.models.map((model) => (
                    <Table.Row key={model.key} id={model.key}>
                      <Table.Cell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-words">{model.name || '未命名模型'}</span>
                          {model.key === defaultKey && <Chip size="sm">默认</Chip>}
                          {!isCompleteModel(model) && (
                            <Chip size="sm" color="warning">
                              待完善
                            </Chip>
                          )}
                        </div>
                        <p className="text-sm text-muted break-all">{model.data?.model}</p>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="break-all">{model.data?.base_url}</span>
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <IconButton
                            label={`编辑 ${model.name}`}
                            disabled={busy || testing}
                            onPress={() => edit(model)}
                          >
                            <Pencil size={16} />
                          </IconButton>
                          <IconButton
                            label={`复制 ${model.name}`}
                            disabled={busy || testing}
                            onPress={() => {
                              const copy = {
                                ...jsonClone(model),
                                key: crypto.randomUUID(),
                                name: `${model.name} 副本`,
                              }
                              void act(
                                () => saveModels((latest) => [...latest, copy]),
                                '模型已复制',
                              )
                            }}
                          >
                            <Copy size={16} />
                          </IconButton>
                          <IconButton
                            label={`将 ${model.name} 设为默认`}
                            disabled={
                              busy || testing || model.key === defaultKey || !isCompleteModel(model)
                            }
                            onPress={() => {
                              void act(() => selectDefaultModel(model.key), '默认模型已更新')
                            }}
                          >
                            <ArrowUp size={16} />
                          </IconButton>
                          <IconButton
                            label={`删除 ${model.name}`}
                            disabled={busy || testing}
                            onPress={() => setDeleting(model)}
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          {editor && (
            <>
              <Separator />
              <section className="flex flex-col gap-4" aria-label="模型编辑">
                <h2 className="text-lg font-semibold">
                  {state.models.some((model) => model.key === editor.key) ? '编辑模型' : '新建模型'}
                </h2>
                <div className="field-grid">
                  <TextField
                    value={editor.name}
                    isDisabled={busy || testing}
                    onChange={(name) => setEditor({ ...editor, name })}
                  >
                    <Label>名称</Label>
                    <Input />
                  </TextField>
                  <TextField
                    value={editor.data?.base_url ?? ''}
                    isDisabled={busy || testing}
                    onChange={(base_url) => changeData({ base_url })}
                  >
                    <Label>API 基础地址</Label>
                    <Input type="url" placeholder="https://api.openai.com/v1" />
                  </TextField>
                  <TextField
                    value={editor.data?.api_key ?? ''}
                    isDisabled={busy || testing}
                    onChange={(api_key) => changeData({ api_key })}
                  >
                    <Label>API Key</Label>
                    <Input type="password" autoComplete="off" />
                  </TextField>
                  <SelectField
                    label="已获取的模型"
                    value={editor.data?.model ?? ''}
                    disabled={busy || testing || !modelIds.length}
                    options={modelIds.map((id) => ({ value: id, label: id }))}
                    onChange={(model) => changeData({ model })}
                  />
                  <Switch
                    className="switch-row"
                    isSelected={editor.data?.responses ?? false}
                    isDisabled={busy || testing}
                    onChange={(responses) => changeData({ responses })}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Label>使用 Responses API</Label>
                    </Switch.Content>
                  </Switch>
                </div>
                {connection && (
                  <Alert status={connection.status === 'connected' ? 'success' : 'warning'}>
                    <Alert.Content>
                      <Alert.Title>{connection.title}</Alert.Title>
                      <Alert.Description>{connection.description}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    isDisabled={busy || testing}
                    onPress={() => {
                      setEditor(null)
                      setError('')
                    }}
                  >
                    取消编辑
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={busy || testing}
                    isPending={testing}
                    onPress={() => {
                      void testConnection()
                    }}
                  >
                    <Plug size={16} />
                    连接测试
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={busy || testing}
                    onPress={() => {
                      void testConnection(true)
                    }}
                  >
                    <ListRestart size={16} />
                    获取模型
                  </Button>
                  <Button
                    isDisabled={busy || testing}
                    onPress={() => {
                      void save()
                    }}
                  >
                    <Save size={16} />
                    保存模型
                  </Button>
                </div>
              </section>
            </>
          )}
        </Tabs.Panel>
        <Tabs.Panel id="prompt-configuration" className="pt-4">
          <Tabs defaultSelectedKey="aiFiltering" className="prompt-purposes">
            <Tabs.ListContainer>
              <Tabs.List aria-label="提示词用途">
                {(Object.keys(promptLabels) as PromptKey[]).map((key) => (
                  <Tabs.Tab key={key} id={key}>
                    {promptLabels[key]}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            {(Object.keys(promptLabels) as PromptKey[]).map((key) => {
              const value = promptDrafts[key] ?? state.config[key]
              const presetConflict =
                !!promptDrafts[key] && promptPresets.current[key] !== state.preset
              const disabled = busy || presetConflict
              const index = Math.min(
                selectedMessages[key] ?? 0,
                Math.max(0, value.prompt.length - 1),
              )
              const item = value.prompt[index]
              const messageLabel = (role: Prompt[number]['role']) =>
                role === 'system' && key === 'aiFiltering' ? '匹配规则' : messageLabels[role]
              return (
                <Tabs.Panel key={key} id={key} className="flex flex-col gap-4 pt-5">
                  {presetConflict && (
                    <Alert status="warning">
                      <Alert.Content>
                        <Alert.Title>配置预设已变更</Alert.Title>
                        <Alert.Description>
                          提示词草稿属于之前的预设。请放弃修改，再编辑当前预设。
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                  <div className="prompt-settings">
                    <Switch
                      className="switch-row prompt-enable"
                      isSelected={value.enable}
                      isDisabled={disabled || key === 'aiReply'}
                      onChange={(enable) => changePrompt(key, { enable })}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Label>
                          {key === 'aiReply' ? 'AI 回复（尚未启用）' : `启用${promptLabels[key]}`}
                        </Label>
                      </Switch.Content>
                    </Switch>
                    {key === 'aiFiltering' && (
                      <NumberField
                        className="prompt-score"
                        value={(value as FormData['aiFiltering']).score}
                        onChange={(score) =>
                          changePrompt(key, { score } as Partial<FormData['aiFiltering']>)
                        }
                        isDisabled={disabled}
                        minValue={0}
                        maxValue={100}
                        step={1}
                      >
                        <Label>通过分数 / 100</Label>
                        <NumberField.Group>
                          <NumberField.DecrementButton />
                          <NumberField.Input />
                          <NumberField.IncrementButton />
                        </NumberField.Group>
                      </NumberField>
                    )}
                  </div>
                  <div className="prompt-workspace">
                    <aside className="prompt-messages" aria-label="提示词消息">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium text-muted">消息顺序</h3>
                        <IconButton
                          label="添加提示词消息"
                          disabled={disabled}
                          onPress={() => {
                            changePrompt(key, {
                              prompt: [...value.prompt, { role: 'user', content: '' }],
                            })
                            setSelectedMessages((current) => ({
                              ...current,
                              [key]: value.prompt.length,
                            }))
                          }}
                        >
                          <Plus size={16} />
                        </IconButton>
                      </div>
                      <div className="prompt-message-list">
                        {value.prompt.map((message, messageIndex) => (
                          <Button
                            key={messageIndex}
                            variant="ghost"
                            className="prompt-message"
                            aria-pressed={messageIndex === index}
                            onPress={() =>
                              setSelectedMessages((current) => ({
                                ...current,
                                [key]: messageIndex,
                              }))
                            }
                          >
                            <span>
                              {messageIndex + 1}. {messageLabel(message.role)}
                            </span>
                            <span className="text-xs text-muted">{message.role}</span>
                          </Button>
                        ))}
                      </div>
                    </aside>
                    {item ? (
                      <div className="prompt-editor" key={index}>
                        <div className="prompt-editor-heading">
                          <h3 className="text-base font-medium">{messageLabel(item.role)}</h3>
                          <div className="prompt-editor-tools">
                            <div className="prompt-role">
                              <SelectField
                                label={`消息 ${index + 1} 角色`}
                                hideLabel
                                value={item.role}
                                disabled={disabled}
                                options={['system', 'user', 'assistant'].map((role) => ({
                                  value: role,
                                  label: role,
                                }))}
                                onChange={(role) =>
                                  changePrompt(key, {
                                    prompt: value.prompt.map((message, i) =>
                                      i === index
                                        ? { ...message, role: role as Prompt[number]['role'] }
                                        : message,
                                    ),
                                  })
                                }
                              />
                            </div>
                            <IconButton
                              label={`删除消息 ${index + 1}`}
                              disabled={disabled}
                              onPress={() => {
                                changePrompt(key, {
                                  prompt: value.prompt.filter((_, i) => i !== index),
                                })
                                setSelectedMessages((current) => ({
                                  ...current,
                                  [key]: Math.min(index, Math.max(0, value.prompt.length - 2)),
                                }))
                              }}
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </div>
                        </div>
                        <TextField
                          className="prompt-content"
                          aria-label={`消息 ${index + 1} 正文`}
                          value={item.content}
                          isDisabled={disabled}
                          onChange={(content) =>
                            changePrompt(key, {
                              prompt: value.prompt.map((message, i) =>
                                i === index ? { ...message, content } : message,
                              ),
                            })
                          }
                        >
                          <TextArea rows={12} />
                        </TextField>
                      </div>
                    ) : (
                      <p className="prompt-empty text-sm text-muted">暂无提示词消息</p>
                    )}
                  </div>
                  {key === 'aiGreeting' && (
                    <CustomGreeting
                      config={{ ...state.config, ...greetingDraft, aiGreeting: value }}
                      disabled={busy || presetConflict}
                      onChange={(field, next) => {
                        changePrompt('aiGreeting', {})
                        setGreetingDraft((draft) => ({ ...draft, [field]: next }))
                      }}
                    />
                  )}
                  <div className="prompt-footer">
                    <Button
                      variant="ghost"
                      size="sm"
                      isDisabled={disabled}
                      onPress={() => {
                        changePrompt(key, { prompt: jsonClone(defaultFormData[key].prompt) })
                        setSelectedMessages((current) => ({ ...current, [key]: 0 }))
                      }}
                    >
                      <RotateCcw size={15} />
                      恢复默认提示词
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={busy || !promptDrafts[key]}
                      onPress={() => discardPrompt(key)}
                    >
                      放弃修改
                    </Button>
                    <Button
                      isDisabled={busy || !promptDrafts[key] || presetConflict}
                      onPress={() => {
                        void savePrompt(key)
                      }}
                    >
                      <Save size={16} />
                      {key === 'aiGreeting' ? '保存招呼语' : '保存提示词'}
                    </Button>
                  </div>
                </Tabs.Panel>
              )
            })}
          </Tabs>
        </Tabs.Panel>
      </Tabs>
      <ConfirmDialog
        open={!!deleting}
        title="删除模型"
        danger
        confirmLabel="删除"
        disabled={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting)
            void act(
              () => saveModels((latest) => latest.filter((model) => model.key !== deleting.key)),
              '模型已删除',
            ).then((ok) => {
              if (ok) {
                if (editor?.key === deleting.key) setEditor(null)
                setDeleting(null)
              }
            })
        }}
      >
        <p>确定删除“{deleting?.name}”？</p>
      </ConfirmDialog>
    </section>
  )
}

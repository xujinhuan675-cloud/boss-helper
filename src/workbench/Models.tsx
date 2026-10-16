/** @jsxImportSource react */
import {
  Accordion,
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
import { ArrowUp, Copy, ListRestart, Pencil, Plug, Plus, Save, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

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

import { act, ConfirmDialog, IconButton, SelectField } from './components'
import { parseObject, validateModels } from './settingsValidation'
import { saveConfig, saveModels, services } from './store'
import { useWorkbench } from './useWorkbench'

type PromptKey = 'aiFiltering' | 'aiGreeting' | 'aiReply'
const promptLabels: Record<PromptKey, string> = {
  aiFiltering: '岗位匹配',
  aiGreeting: '开场招呼语',
  aiReply: '回复提示词',
}
type ModelDraft = { model: ModelConf; advanced: string; other: string }

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
  const [editor, setEditor] = useState<ModelDraft | null>(null)
  const [deleting, setDeleting] = useState<ModelConf | null>(null)
  const [promptDrafts, setPromptDrafts] = useState<Partial<Pick<FormData, PromptKey>>>({})
  const promptPresets = useRef<Partial<Record<PromptKey, string>>>({})
  const [testing, setTesting] = useState(false)
  const testingRef = useRef(false)
  const [connection, setConnection] = useState<ModelConnectionResult | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
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

  function edit(model?: ModelConf) {
    if (busy || testingRef.current) return
    const draft = jsonClone<ModelConf>(
      model ?? {
        key: crypto.randomUUID(),
        name: '',
        data: {
          mode: 'openai',
          avatar: '',
          base_url: '',
          api_key: '',
          model: '',
          advanced: {},
          other: {},
        },
      },
    )
    setEditor({
      model: draft,
      advanced: JSON.stringify(draft.data?.advanced ?? {}, null, 2),
      other: JSON.stringify(draft.data?.other ?? {}, null, 2),
    })
    setConnection(null)
    setAvailableModels([])
    setError('')
  }

  function changeData(patch: Partial<OpenaiLLMConf>) {
    if (!editor) return
    setEditor({
      ...editor,
      model: {
        ...editor.model,
        data: { mode: 'openai', ...editor.model.data, ...patch } as OpenaiLLMConf,
      },
    })
    setConnection(null)
    setAvailableModels([])
  }

  function modelSnapshot(): ModelConf {
    if (!editor) throw new Error('请先选择模型')
    const next = jsonClone(editor.model)
    next.data = {
      mode: 'openai',
      ...next.data,
      advanced: parseObject(editor.advanced, '高级配置'),
      other: parseObject(editor.other, '其他配置'),
    } as OpenaiLLMConf
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
    setAvailableModels([])
    let next: ModelConf
    try {
      next = modelSnapshot()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return
    }
    testingRef.current = true
    setTesting(true)
    try {
      const result = await testModelConnection(next.data!, fetchModelsThroughBackground)
      setConnection(result)
      if (select && result.status === 'connected' && result.models?.length) {
        setAvailableModels(result.models)
        setEditor((current) =>
          current
            ? {
                ...current,
                model: {
                  ...current.model,
                  data: {
                    ...current.model.data!,
                    model: selectAvailableModel(current.model.data?.model ?? '', result.models!),
                  },
                },
              }
            : current,
        )
      }
    } catch (error) {
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
        await act(() => {
          if (promptPresets.current[key] !== services.conf.formDataPreset.value)
            throw new Error('配置预设已变更，请先放弃提示词草稿并重新加载当前预设')
          return saveConfig({ [key]: value })
        }, '提示词已保存')
      )
        discardPrompt(key)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">模型与提示词</h1>
        <div className="flex flex-wrap gap-2">
          <Button isDisabled={busy || testing} onPress={() => edit()}>
            <Plus size={16} />
            新建模型
          </Button>
        </div>
      </div>
      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>操作未完成</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label="AI 模型">
            <Table.Header>
              <Table.Column isRowHeader>模型</Table.Column>
              <Table.Column>API 地址</Table.Column>
              <Table.Column>管理</Table.Column>
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
                  <Table.Cell>
                    <div className="flex flex-wrap gap-1">
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
                          void act(() => saveModels((latest) => [...latest, copy]), '模型已复制')
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
                          void act(
                            () =>
                              saveModels((latest) => {
                                const selected = latest.find((item) => item.key === model.key)
                                if (!selected || !isCompleteModel(selected))
                                  throw new Error('模型已在其他窗口变更，请重新选择默认模型')
                                return [
                                  selected,
                                  ...latest.filter((item) => item.key !== model.key),
                                ]
                              }),
                            '默认模型已更新',
                          )
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
              {state.models.some((model) => model.key === editor.model.key)
                ? '编辑模型'
                : '新建模型'}
            </h2>
            <div className="field-grid">
              <TextField
                value={editor.model.name}
                isDisabled={busy || testing}
                onChange={(name) => setEditor({ ...editor, model: { ...editor.model, name } })}
              >
                <Label>名称</Label>
                <Input />
              </TextField>
              <TextField
                value={editor.model.data?.base_url ?? ''}
                isDisabled={busy || testing}
                onChange={(base_url) => changeData({ base_url })}
              >
                <Label>API 基础地址</Label>
                <Input type="url" placeholder="https://api.openai.com/v1" />
              </TextField>
              <TextField
                value={editor.model.data?.api_key ?? ''}
                isDisabled={busy || testing}
                onChange={(api_key) => changeData({ api_key })}
              >
                <Label>API Key</Label>
                <Input type="password" autoComplete="off" />
              </TextField>
              <TextField
                value={editor.model.data?.model ?? ''}
                isDisabled={busy || testing}
                onChange={(model) => changeData({ model })}
              >
                <Label>模型 ID</Label>
                <Input />
              </TextField>
              <TextField
                value={editor.model.data?.avatar ?? ''}
                isDisabled={busy || testing}
                onChange={(avatar) => changeData({ avatar })}
              >
                <Label>头像地址</Label>
                <Input />
              </TextField>
              <Switch
                isSelected={editor.model.data?.responses ?? false}
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
            {availableModels.length > 0 && (
              <SelectField
                label="已获取的模型"
                value={editor.model.data?.model ?? ''}
                disabled={busy || testing}
                options={availableModels.map((id) => ({ value: id, label: id }))}
                onChange={(model) => changeData({ model })}
              />
            )}
            <Accordion>
              <Accordion.Item id="model-advanced">
                <Accordion.Heading>
                  <Accordion.Trigger>
                    高级配置
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="flex flex-col gap-4">
                    <TextField
                      value={editor.advanced}
                      isDisabled={busy || testing}
                      onChange={(advanced) => {
                        setEditor({ ...editor, advanced })
                        setConnection(null)
                        setAvailableModels([])
                      }}
                    >
                      <Label>高级参数 JSON</Label>
                      <TextArea rows={12} />
                    </TextField>
                    <TextField
                      value={editor.other}
                      isDisabled={busy || testing}
                      onChange={(other) => setEditor({ ...editor, other })}
                    >
                      <Label>其他参数 JSON</Label>
                      <TextArea rows={5} />
                    </TextField>
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
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
      <Separator />
      <h2 className="text-lg font-semibold">提示词</h2>
      <Tabs defaultSelectedKey="aiFiltering">
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
          const presetConflict = !!promptDrafts[key] && promptPresets.current[key] !== state.preset
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
              <div className="field-grid">
                <Switch
                  isSelected={value.enable}
                  isDisabled={busy || key === 'aiReply'}
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
                <SelectField
                  label="使用模型"
                  value={value.model ?? '__default__'}
                  disabled={busy}
                  options={[
                    { value: '__default__', label: '跟随默认模型' },
                    ...state.models.map((model) => ({
                      value: model.key,
                      label: model.name || model.key,
                    })),
                  ]}
                  onChange={(model) =>
                    changePrompt(key, { model: model === '__default__' ? undefined : model })
                  }
                />
                {key === 'aiFiltering' && (
                  <NumberField
                    value={(value as FormData['aiFiltering']).score}
                    onChange={(score) =>
                      changePrompt(key, { score } as Partial<FormData['aiFiltering']>)
                    }
                    isDisabled={busy}
                    minValue={0}
                    maxValue={100}
                    step={1}
                  >
                    <Label>通过分数（满分 100）</Label>
                    <NumberField.Group>
                      <NumberField.DecrementButton />
                      <NumberField.Input />
                      <NumberField.IncrementButton />
                    </NumberField.Group>
                  </NumberField>
                )}
              </div>
              {value.prompt.map((item, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <SelectField
                        label={`消息 ${index + 1} 角色`}
                        value={item.role}
                        disabled={busy}
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
                      disabled={busy}
                      onPress={() =>
                        changePrompt(key, { prompt: value.prompt.filter((_, i) => i !== index) })
                      }
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                  <TextField
                    aria-label={`消息 ${index + 1} 正文`}
                    value={item.content}
                    isDisabled={busy}
                    onChange={(content) =>
                      changePrompt(key, {
                        prompt: value.prompt.map((message, i) =>
                          i === index ? { ...message, content } : message,
                        ),
                      })
                    }
                  >
                    <TextArea rows={8} />
                  </TextField>
                </div>
              ))}
              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() =>
                      changePrompt(key, {
                        prompt: [...value.prompt, { role: 'user', content: '' }],
                      })
                    }
                  >
                    <Plus size={16} />
                    添加消息
                  </Button>
                  <Button
                    variant="tertiary"
                    isDisabled={busy}
                    onPress={() =>
                      changePrompt(key, { prompt: jsonClone(defaultFormData[key].prompt) })
                    }
                  >
                    恢复默认提示词
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
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
                    保存提示词
                  </Button>
                </div>
              </div>
            </Tabs.Panel>
          )
        })}
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
                if (editor?.model.key === deleting.key) setEditor(null)
                setDeleting(null)
              }
            })
        }}
      >
        <p>确定删除“{deleting?.name}”？引用此模型的提示词将需要重新选择模型。</p>
      </ConfirmDialog>
    </section>
  )
}

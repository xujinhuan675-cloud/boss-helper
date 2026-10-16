/** @jsxImportSource react */
import { Button, Chip, Input, Label, Separator, Table, TextArea, TextField } from '@heroui/react'
import { Copy, FilePlus2, Pencil, Save, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'

import type { ResumeRecord } from '@/composables/useResume'

import { act, ConfirmDialog, IconButton, SelectField } from './components'
import { command, copyResume, deleteResume, openBoss, saveResume, selectResume } from './store'
import { useWorkbench } from './useWorkbench'

export function Resumes() {
  const state = useWorkbench()
  const { runtime, resumes: library } = state
  const [editing, setEditing] = useState<{
    id: string | null
    name: string
    content: string
  } | null>(null)
  const [deleting, setDeleting] = useState<ResumeRecord | null>(null)
  const [replacement, setReplacement] = useState('__none__')
  const [keywordDraft, setKeywordDraft] = useState<string | null>(null)
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
  const current = library.resumes.find((resume) => resume.id === library.currentResumeId)
  const keywords =
    keywordDraft ??
    runtime?.keywords ??
    runtime?.keywordRotation?.items.map((item) => item.keyword).join('\n') ??
    ''

  async function save() {
    if (busy || !editing) return
    if (await act(() => saveResume(editing.id, editing.name, editing.content), '简历已保存'))
      setEditing(null)
  }

  async function remove() {
    if (busy || !deleting) return
    const next =
      deleting.id === library.currentResumeId
        ? replacement === '__none__'
          ? null
          : replacement
        : undefined
    if (await act(() => deleteResume(deleting.id, next), '简历已删除')) {
      if (editing?.id === deleting.id) setEditing(null)
      setDeleting(null)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">简历与求职方向</h1>
          <p className="text-sm text-muted">
            {current ? `当前使用：${current.name}` : '当前未使用简历'}
          </p>
        </div>
        <Button onPress={() => setEditing({ id: null, name: '', content: '' })} isDisabled={busy}>
          <FilePlus2 size={16} />
          新建简历
        </Button>
      </div>
      <SelectField
        label="AI 使用的简历"
        value={library.currentResumeId ?? '__none__'}
        disabled={busy}
        options={[
          { value: '__none__', label: '不使用简历' },
          ...library.resumes.map((resume) => ({ value: resume.id, label: resume.name })),
        ]}
        onChange={(id) => {
          void act(() => selectResume(id === '__none__' ? null : id), '当前简历已更新')
        }}
      />
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label="简历列表">
            <Table.Header>
              <Table.Column isRowHeader>简历</Table.Column>
              <Table.Column>更新时间</Table.Column>
              <Table.Column>管理</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => <p className="p-4 text-sm text-muted">还没有简历</p>}
            >
              {library.resumes.map((resume) => (
                <Table.Row key={resume.id} id={resume.id}>
                  <Table.Cell>
                    <span className="break-words">{resume.name}</span>
                    {resume.id === library.currentResumeId && (
                      <Chip size="sm" className="ml-2">
                        当前使用
                      </Chip>
                    )}
                  </Table.Cell>
                  <Table.Cell>{new Date(resume.updatedAt).toLocaleString('zh-CN')}</Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1">
                      <IconButton
                        label={`编辑 ${resume.name}`}
                        disabled={busy}
                        onPress={() =>
                          setEditing({ id: resume.id, name: resume.name, content: resume.content })
                        }
                      >
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton
                        label={`复制 ${resume.name}`}
                        disabled={busy}
                        onPress={() => {
                          void act(() => copyResume(resume.id), '简历已复制')
                        }}
                      >
                        <Copy size={16} />
                      </IconButton>
                      <IconButton
                        label={`删除 ${resume.name}`}
                        disabled={busy}
                        onPress={() => {
                          setDeleting(resume)
                          setReplacement('__none__')
                        }}
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
      {editing && (
        <>
          <Separator />
          <section
            className="flex flex-col gap-4"
            aria-label={editing.id ? '编辑简历' : '新建简历'}
          >
            <h2 className="text-lg font-semibold">{editing.id ? '编辑简历' : '新建简历'}</h2>
            <TextField
              value={editing.name}
              onChange={(name) => setEditing({ ...editing, name })}
              isDisabled={busy}
            >
              <Label>简历名称</Label>
              <Input />
            </TextField>
            <TextField
              value={editing.content}
              onChange={(content) => setEditing({ ...editing, content })}
              isDisabled={busy}
            >
              <Label>完整简历正文</Label>
              <TextArea rows={18} />
            </TextField>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" isDisabled={busy} onPress={() => setEditing(null)}>
                取消编辑
              </Button>
              <Button
                isDisabled={busy}
                onPress={() => {
                  void save()
                }}
              >
                <Save size={16} />
                保存简历
              </Button>
            </div>
          </section>
        </>
      )}
      <Separator />
      <section className="flex flex-col gap-4" aria-label="岗位关键词轮换">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">岗位关键词</h2>
          <Button
            variant="secondary"
            isDisabled={
              busy || !state.connected || !(editing ? editing.content : current?.content)?.trim()
            }
            isPending={!!runtime?.keywordExtractionBusy}
            onPress={() => {
              void act(() =>
                command({
                  type: 'extractKeywords',
                  input: editing ? editing.content : (current?.content ?? ''),
                }),
              ).then((ok) => {
                if (ok) setKeywordDraft(null)
              })
            }}
          >
            <Sparkles size={16} />
            从简历提取
          </Button>
        </div>
        <TextField
          value={keywords}
          onChange={setKeywordDraft}
          isDisabled={busy || !state.connected}
        >
          <Label>岗位搜索关键词</Label>
          <TextArea rows={8} />
        </TextField>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!state.connected ? (
            <Button
              variant="tertiary"
              onPress={() => {
                void openBoss()
              }}
            >
              连接 BOSS 页面
            </Button>
          ) : (
            <output className="text-sm text-muted" aria-live="polite">
              {runtime?.keywordExtractionBusy
                ? '正在提取关键词'
                : `${keywords.split(/\n/).filter((item) => item.trim()).length} 个关键词`}
            </output>
          )}
          <Button
            isDisabled={busy || !state.connected || !keywords.trim()}
            onPress={() => {
              void act(
                () => command({ type: 'saveKeywords', input: keywords }),
                '关键词已保存',
              ).then((ok) => {
                if (ok) setKeywordDraft(null)
              })
            }}
          >
            <Save size={16} />
            保存关键词
          </Button>
        </div>
      </section>
      <ConfirmDialog
        open={!!deleting}
        title="删除简历"
        danger
        confirmLabel="删除"
        disabled={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          void remove()
        }}
      >
        <p>确定删除“{deleting?.name}”？</p>
        {deleting?.id === library.currentResumeId && (
          <SelectField
            label="删除后使用"
            value={replacement}
            disabled={busy}
            options={[
              { value: '__none__', label: '进入无简历状态' },
              ...library.resumes
                .filter((resume) => resume.id !== deleting.id)
                .map((resume) => ({ value: resume.id, label: resume.name })),
            ]}
            onChange={setReplacement}
          />
        )}
      </ConfirmDialog>
    </section>
  )
}

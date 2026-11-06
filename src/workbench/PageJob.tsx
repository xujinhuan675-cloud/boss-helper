/** @jsxImportSource react */
import { Button, Link, Spinner, Tooltip } from '@heroui/react'
import {
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { JobData } from '@/composables/useHelper/type'

import { hasCompleteJobDetail } from '../entrypoints/boss/jobDetails'
import { ConfirmDialog, IconButton, act } from './components'
import { JobAnalysisResult } from './JobAnalysisResult'
import {
  getResumeTailoringInputError,
  openResumeMatcher,
  RESUME_MATCHER_BASE_URL,
} from './resumeMatcher'
import { command } from './store'
import { useWorkbench } from './useWorkbench'

export function PageJob({
  job,
  disabled,
  status,
  detail = false,
  viewed: viewedOverride,
}: {
  job: JobData
  disabled: boolean
  status: string
  detail?: boolean
  viewed?: boolean
}) {
  const state = useWorkbench()
  const jobId = job.key.slice('boss::'.length)
  const record = state.records.find((item) => item.encryptJobId === jobId)
  const needsDetail = !!record && !hasCompleteJobDetail(record)
  const action = state.runtime?.jobActions?.[jobId]
  const viewed = viewedOverride ?? state.runtime?.viewedJobKey === job.key
  const rowRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const row = rowRef.current
    const list = row?.parentElement
    if (!viewed || !row || !list) return
    const bounds = row.getBoundingClientRect()
    const viewport = list.getBoundingClientRect()
    if (bounds.top < viewport.top) list.scrollTop += bounds.top - viewport.top
    else if (bounds.bottom > viewport.bottom)
      list.scrollTop += Math.min(bounds.bottom - viewport.bottom, bounds.top - viewport.top)
  }, [viewed])
  const [expanded, setExpanded] = useState<'analysis' | 'greeting' | 'tailor' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sendConfirm, setSendConfirm] = useState(false)
  const running = submitting || action?.status === 'running'
  const locked = disabled || running || capturing
  const protectedJob =
    record?.processingStatus === 'excluded' ||
    (!!record && (record.reviewStatus !== 'pending' || record.sendStatus !== 'pending'))

  async function execute(type: 'analyzeOne' | 'generateGreeting' | 'sendGreeting') {
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      if (type !== 'sendGreeting') {
        const resume = state.resumes.resumes.find(
          (item) => item.id === state.resumes.currentResumeId,
        )
        if (!resume?.content.trim()) throw new Error('请先在简历页选择并保存完整简历，再开始分析')
      }
      await command(
        type === 'sendGreeting'
          ? { type, jobId, greeting: record?.finalGreeting || '' }
          : { type, jobId },
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSubmitting(false)
    }
  }

  function show(section: 'analysis' | 'greeting') {
    setExpanded(section)
    setError('')
    setNotice('')
    if (section === 'analysis' ? record?.analysisStatus === 'ready' : !!record?.finalGreeting)
      return
    void execute(section === 'analysis' ? 'analyzeOne' : 'generateGreeting')
  }

  function tailorResume() {
    setError('')
    setNotice('')
    setExpanded('tailor')
    const inputError = getResumeTailoringInputError(job)
    if (inputError) {
      setError(inputError)
      return
    }
    if (!openResumeMatcher(job)) {
      setError('浏览器阻止了新标签页，请允许弹出窗口后重试')
      return
    }
    setNotice('已打开 Resume Matcher')
  }

  return (
    <li
      ref={rowRef}
      aria-current={viewed ? 'true' : undefined}
      className={`min-w-0 space-y-2 border-l-2 px-2 py-3 ${viewed ? 'border-accent bg-accent/10' : 'border-transparent'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-sm font-medium break-words">{job.jobName}</p>
            {viewed && <span className="shrink-0 text-xs font-medium text-accent">正在浏览</span>}
          </div>
          <p className="text-xs text-muted break-words">
            {job.brand.name} · {job.salary}
          </p>
        </div>
        {record && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-right text-xs ${record.processingStatus === 'excluded' ? 'bg-default text-muted' : 'bg-success/10 text-success'}`}
          >
            {record.processingStatus === 'excluded' ? '已排除' : '已入库'}
            {record.processingStatus !== 'excluded' && needsDetail && (
              <span className="block">待补详情</span>
            )}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status && <span className="mr-auto text-xs text-muted">{status}</span>}
        <div className="flex flex-wrap items-center gap-1">
          <IconButton
            label="在 BOSS 打开岗位"
            disabled={locked || detail}
            onPress={() => {
              void act(() => command({ type: 'openJob', key: job.key }))
            }}
          >
            <ExternalLink size={16} />
          </IconButton>
          <Tooltip>
            <Link
              aria-label="打开岗位详情页"
              href={`https://www.zhipin.com/job_detail/${encodeURIComponent(jobId)}.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="button button--sm button--ghost button--icon-only"
            >
              <FileText size={16} />
            </Link>
            <Tooltip.Content>打开岗位详情页</Tooltip.Content>
          </Tooltip>
          <IconButton
            label={
              capturing
                ? '采集中'
                : state.config.paddleOcr.enabled && !detail
                  ? 'OCR采集并保存'
                  : needsDetail
                    ? '补详情'
                    : '保存岗位'
            }
            disabled={
              locked || record?.processingStatus === 'excluded' || (!!record && !needsDetail)
            }
            onPress={async () => {
              setCapturing(true)
              try {
                await act(
                  () => command({ type: 'captureJob', key: job.key }),
                  needsDetail ? '岗位详情已补全' : '已保存岗位',
                )
              } finally {
                setCapturing(false)
              }
            }}
          >
            {capturing ? (
              <Spinner size="sm" />
            ) : needsDetail ? (
              <RefreshCw size={16} />
            ) : (
              <Save size={16} />
            )}
          </IconButton>
          <IconButton
            label="分析岗位"
            disabled={locked && record?.analysisStatus !== 'ready'}
            onPress={() => show('analysis')}
          >
            <WandSparkles size={16} />
          </IconButton>
          <Tooltip>
            <Link
              aria-label="在 Resume Matcher 中定制简历"
              href={`${RESUME_MATCHER_BASE_URL}/tailor`}
              target="_blank"
              className="button button--sm button--ghost button--icon-only"
              onClick={(event) => {
                event.preventDefault()
                if (!locked) tailorResume()
              }}
            >
              <ExternalLink size={16} />
            </Link>
            <Tooltip.Content>在 Resume Matcher 中定制简历</Tooltip.Content>
          </Tooltip>
          <IconButton
            label={record?.finalGreeting ? '查看招呼语' : '生成招呼语'}
            disabled={locked && !record?.finalGreeting}
            onPress={() => show('greeting')}
          >
            <MessageSquareText size={16} />
          </IconButton>
        </div>
      </div>
      {expanded && (
        <section
          aria-label={`${job.jobName}的${expanded === 'analysis' ? 'AI 分析' : expanded === 'tailor' ? '定制简历' : '招呼语'}`}
          className="min-w-0 space-y-3 pt-2"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              {expanded === 'analysis' ? 'AI 分析' : expanded === 'tailor' ? '定制简历' : '招呼语'}
            </h3>
            <IconButton label="收起结果" onPress={() => setExpanded(null)}>
              <ChevronUp size={16} />
            </IconButton>
          </div>
          {running && (
            <output aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" />
              {action?.type === 'sendGreeting'
                ? '正在发送招呼语'
                : expanded === 'greeting'
                  ? '生成招呼语中'
                  : '岗位分析中'}
            </output>
          )}
          {(error || action?.error) && (
            <p role="alert" className="text-sm break-words text-danger">
              {error || action?.error}
            </p>
          )}
          {expanded === 'analysis' ? (
            <JobAnalysisResult record={record} />
          ) : expanded === 'tailor' ? (
            <p className="text-sm text-muted">{notice || '未打开 Resume Matcher'}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-sm">
                {record?.finalGreeting || '尚未生成招呼语'}
              </p>
              <div className="flex flex-wrap justify-end gap-1">
                <IconButton
                  label="复制招呼语"
                  disabled={!record?.finalGreeting}
                  onPress={() => {
                    setError('')
                    void navigator.clipboard
                      .writeText(record?.finalGreeting || '')
                      .then(() => setNotice('已复制招呼语'))
                      .catch(() => setError('复制失败，请手动选择招呼语复制'))
                  }}
                >
                  <Copy size={16} />
                </IconButton>
                <IconButton
                  label="重新生成招呼语"
                  disabled={locked || protectedJob}
                  onPress={() => {
                    void execute('generateGreeting')
                  }}
                >
                  <RefreshCw size={16} />
                </IconButton>
                <Button
                  size="sm"
                  aria-label="发送招呼语"
                  isDisabled={locked || detail || protectedJob || !record?.finalGreeting}
                  onPress={() => setSendConfirm(true)}
                >
                  <Send size={16} />
                  打招呼
                </Button>
              </div>
            </>
          )}
          {(notice || action?.status === 'completed') && (
            <output className="block text-xs text-muted">
              {notice ||
                (action?.type === 'sendGreeting'
                  ? '招呼语已提交，请在 BOSS 沟通记录确认'
                  : '结果已保存')}
            </output>
          )}
          <ConfirmDialog
            open={sendConfirm}
            onClose={() => setSendConfirm(false)}
            title="确认发送招呼语"
            confirmLabel="发送"
            disabled={locked || detail || protectedJob || !record?.finalGreeting}
            onConfirm={() => {
              setSendConfirm(false)
              void execute('sendGreeting')
            }}
          >
            <p>
              将向 {job.brand.name} 的「{job.jobName}」发送以下招呼语。
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">{record?.finalGreeting}</p>
          </ConfirmDialog>
        </section>
      )}
    </li>
  )
}

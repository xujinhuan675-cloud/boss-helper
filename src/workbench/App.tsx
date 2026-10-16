/** @jsxImportSource react */
import { Button, Chip, Popover, Spinner, Tabs, Toast, Tooltip } from '@heroui/react'
import {
  Bot,
  BriefcaseBusiness,
  ClipboardList,
  ExternalLink,
  FileUser,
  Info,
  ListChecks,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { IconButton, SelectField, act } from './components'
import { Jobs } from './Jobs'
import { Logs } from './Logs'
import { Models } from './Models'
import { Resumes } from './Resumes'
import { Settings } from './Settings'
import { openBoss, openWorkbench, refreshTabs, selectTab } from './store'
import { Tasks } from './Tasks'
import { useWorkbench } from './useWorkbench'

const views = [
  { id: 'tasks', label: '任务', icon: ListChecks },
  { id: 'jobs', label: '岗位库', icon: BriefcaseBusiness },
  { id: 'resumes', label: '简历', icon: FileUser },
  { id: 'models', label: '模型与提示词', icon: Bot },
  { id: 'settings', label: '任务设置', icon: Settings2 },
  { id: 'logs', label: '运行日志', icon: ClipboardList },
] as const

export function App({ mode }: { mode: 'sidepanel' | 'workbench' }) {
  const state = useWorkbench()
  const compact = mode === 'sidepanel'
  const [view, setView] = useState(() =>
    views.some((item) => item.id === location.hash.slice(1)) ? location.hash.slice(1) : 'tasks',
  )
  const [narrow, setNarrow] = useState(window.innerWidth <= 760)
  const [dark, setDark] = useState(() => localStorage.getItem('boss-helper-theme') === 'dark')
  const notice = state.error || state.connectionError || state.runtime?.lastError
  useEffect(() => {
    const query = matchMedia('(max-width: 760px)')
    const resized = () => setNarrow(query.matches)
    query.addEventListener('change', resized)
    const route = () => {
      if (views.some((item) => item.id === location.hash.slice(1))) setView(location.hash.slice(1))
    }
    window.addEventListener('hashchange', route)
    return () => {
      query.removeEventListener('change', resized)
      window.removeEventListener('hashchange', route)
    }
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('boss-helper-theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <div className={compact ? 'sidepanel' : 'workbench-shell'}>
      <Toast.Provider />
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/icons/48.png" alt="" className="size-8 shrink-0" />
          <span className="truncate text-lg font-semibold">BossHelper</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Chip size="sm" color={state.connected ? 'success' : 'default'}>
            {state.connected ? '已连接' : '未连接'}
          </Chip>
          {(notice || state.settingsWarning) && (
            <Popover>
              <Tooltip>
                <Button isIconOnly size="sm" variant="ghost" aria-label="查看连接与运行提示">
                  <Info size={17} className="text-muted" />
                </Button>
                <Tooltip.Content>查看连接与运行提示</Tooltip.Content>
              </Tooltip>
              <Popover.Content
                placement="bottom end"
                className="max-w-[min(320px,calc(100vw-32px))]"
              >
                <Popover.Dialog className="space-y-2">
                  <Popover.Heading>连接与运行提示</Popover.Heading>
                  {notice && <p className="text-sm text-muted break-words">{notice}</p>}
                  {state.settingsWarning && (
                    <p className="text-sm text-muted break-words">{state.settingsWarning}</p>
                  )}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          )}
          <IconButton label={dark ? '浅色模式' : '深色模式'} onPress={() => setDark(!dark)}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          {compact && (
            <IconButton
              label="打开工作台"
              onPress={() => {
                void openWorkbench()
              }}
            >
              <ExternalLink size={17} />
            </IconButton>
          )}
        </div>
      </header>
      {state.loading ? (
        <output className="flex min-h-48 items-center justify-center gap-3 text-muted">
          <Spinner size="sm" />
          读取本地数据
        </output>
      ) : (
        <>
          <div
            className={`execution-toolbar border-b border-border bg-surface px-4 py-3 ${compact ? '' : 'sm:px-6'}`}
          >
            <div className="min-w-0 flex-1">
              <SelectField
                label="执行标签页"
                value={state.tabId === null ? 'none' : String(state.tabId)}
                options={
                  state.tabs.length
                    ? state.tabs.map((tab) => ({ value: String(tab.id), label: tab.title }))
                    : [{ value: 'none', label: '没有打开的 BOSS 标签页' }]
                }
                onChange={(value) => selectTab(Number(value))}
                disabled={state.saving || !state.tabs.length}
              />
            </div>
            <div className="flex h-9 shrink-0 items-center gap-1">
              <IconButton
                label="重新连接"
                onPress={() => {
                  void act(refreshTabs)
                }}
                disabled={state.saving}
              >
                <RefreshCw size={17} />
              </IconButton>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  void openBoss()
                }}
              >
                <ExternalLink size={15} />
                BOSS
              </Button>
            </div>
          </div>
          {compact ? (
            <div className="p-4">
              <Tasks compact />
            </div>
          ) : (
            <Tabs
              className="workbench-tabs"
              orientation={narrow ? 'horizontal' : 'vertical'}
              selectedKey={view}
              onSelectionChange={(key) => {
                setView(String(key))
                location.hash = String(key)
              }}
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="工作台导航">
                  {views.map(({ id, label, icon: Icon }) => (
                    <Tabs.Tab key={id} id={id}>
                      <Icon size={18} />
                      <span>{label}</span>
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="tasks" className="workbench-panel">
                <Tasks />
              </Tabs.Panel>
              <Tabs.Panel id="jobs" className="workbench-panel">
                <Jobs />
              </Tabs.Panel>
              <Tabs.Panel id="resumes" className="workbench-panel">
                <Resumes />
              </Tabs.Panel>
              <Tabs.Panel id="models" className="workbench-panel">
                <Models />
              </Tabs.Panel>
              <Tabs.Panel id="settings" className="workbench-panel">
                <Settings />
              </Tabs.Panel>
              <Tabs.Panel id="logs" className="workbench-panel">
                <Logs />
              </Tabs.Panel>
            </Tabs>
          )}
        </>
      )}
    </div>
  )
}

/** @jsxImportSource react */
import { Chip, Link, Spinner, Toast } from '@heroui/react'
import {
  Bot,
  BriefcaseBusiness,
  ClipboardList,
  FileUser,
  Filter,
  LayoutDashboard,
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
import { openBoss, openWorkbench, reconnectExecutor, selectTab } from './store'
import { Tasks } from './Tasks'
import { useWorkbench } from './useWorkbench'

const views = [
  { id: 'jobs', label: '岗位库', icon: BriefcaseBusiness, group: '求职管理' },
  { id: 'resumes', label: '简历与方向', icon: FileUser, group: '求职管理' },
  { id: 'filters', label: '筛选规则', icon: Filter, group: '自动化配置' },
  { id: 'models', label: '模型与提示词', icon: Bot, group: '自动化配置' },
  { id: 'settings', label: '任务设置', icon: Settings2, group: '自动化配置' },
  { id: 'logs', label: '运行日志', icon: ClipboardList, group: '运行排查' },
] as const

export function App({ mode }: { mode: 'sidepanel' | 'workbench' }) {
  const state = useWorkbench()
  const compact = mode === 'sidepanel'
  const [view, setView] = useState(() =>
    views.some((item) => item.id === location.hash.slice(1)) ? location.hash.slice(1) : 'jobs',
  )
  const [dark, setDark] = useState(() => localStorage.getItem('boss-helper-theme') === 'dark')
  useEffect(() => {
    const route = () => {
      const requested = location.hash.slice(1)
      const next = views.some((item) => item.id === requested) ? requested : 'jobs'
      setView(next)
      if (requested !== next && !compact)
        location.replace(`${location.pathname}${location.search}#${next}`)
    }
    route()
    window.addEventListener('hashchange', route)
    return () => {
      window.removeEventListener('hashchange', route)
    }
  }, [compact])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('boss-helper-theme', dark ? 'dark' : 'light')
  }, [dark])
  const themeButton = (
    <IconButton label={dark ? '浅色模式' : '深色模式'} onPress={() => setDark(!dark)}>
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </IconButton>
  )

  return (
    <div className={compact ? 'sidepanel' : 'workbench-shell'}>
      <Toast.Provider placement="top end" />
      <header
        className={`sticky top-0 z-20 flex items-center border-b border-border bg-background ${compact ? 'h-12 gap-1 px-2' : 'h-16 justify-between gap-3 px-4 sm:px-6'}`}
      >
        {!compact && (
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/icons/logo.png" alt="" className="size-8 shrink-0" />
            <span className="truncate text-lg font-semibold">OfferHunt</span>
          </div>
        )}
        {compact && (
          <div className="sidepanel-header-controls">
            <div className="sidepanel-tab-select min-w-0">
              <SelectField
                label="BOSS 岗位页"
                hideLabel
                value={state.tabId === null ? 'none' : String(state.tabId)}
                options={
                  state.tabs.length
                    ? state.tabs.map((tab) => ({ value: String(tab.id), label: tab.title }))
                    : [{ value: 'none', label: 'BOSS 岗位页' }]
                }
                onChange={(value) => selectTab(Number(value))}
                disabled={state.saving || !state.tabs.length}
              />
            </div>
            <div className="sidepanel-connection-controls flex shrink-0 items-center gap-1">
              <IconButton
                label="重新连接"
                onPress={() => {
                  void act(reconnectExecutor)
                }}
                disabled={state.saving}
              >
                <RefreshCw size={17} />
              </IconButton>
              <IconButton
                label={state.connected ? '打开已连接的 BOSS 岗位页' : '打开 BOSS 岗位页以连接'}
                onPress={() => {
                  void openBoss()
                }}
              >
                <span className="relative inline-flex">
                  <BriefcaseBusiness size={17} />
                  {!state.connected && (
                    <span aria-hidden="true" className="connection-status-dot" />
                  )}
                </span>
              </IconButton>
              <Chip size="sm" color={state.connected ? 'success' : 'default'}>
                {state.connected ? '已连接' : '未连接'}
              </Chip>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <IconButton
                label="运行诊断"
                onPress={() => {
                  void openWorkbench('logs')
                }}
              >
                <ClipboardList size={17} />
              </IconButton>
              {themeButton}
              <IconButton
                label="打开工作台"
                onPress={() => {
                  void openWorkbench()
                }}
              >
                <LayoutDashboard size={17} />
              </IconButton>
            </div>
          </div>
        )}
        {!compact && <div className="flex shrink-0 items-center gap-1">{themeButton}</div>}
      </header>
      {state.loading ? (
        <output className="flex min-h-48 items-center justify-center gap-3 text-muted">
          <Spinner size="sm" />
          读取本地数据
        </output>
      ) : (
        <>
          {compact ? (
            <div className="p-4">
              <Tasks />
            </div>
          ) : (
            <div className="workbench-layout">
              <nav aria-label="工作台导航" className="workbench-navigation">
                {['求职管理', '自动化配置', '运行排查'].map((group) => (
                  <div key={group} className="workbench-nav-group">
                    <h2 className="px-3 text-xs font-medium text-muted">{group}</h2>
                    <div className="workbench-nav-links">
                      {views
                        .filter((item) => item.group === group)
                        .map(({ id, label, icon: Icon }) => (
                          <Link
                            key={id}
                            href={`#${id}`}
                            aria-current={view === id ? 'page' : undefined}
                            className="workbench-nav-item"
                          >
                            <Icon size={18} aria-hidden="true" className="shrink-0" />
                            <span>{label}</span>
                          </Link>
                        ))}
                    </div>
                  </div>
                ))}
              </nav>
              <main className="workbench-panel" key={view}>
                {view === 'jobs' && <Jobs />}
                {view === 'resumes' && <Resumes />}
                {view === 'models' && <Models />}
                {view === 'settings' && <Settings />}
                {view === 'filters' && <Settings page="filters" />}
                {view === 'logs' && <Logs />}
              </main>
            </div>
          )}
        </>
      )}
    </div>
  )
}

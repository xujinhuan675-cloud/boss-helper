/** @jsxImportSource react */
import { Table } from '@heroui/react'
import { useState } from 'react'

import { SelectField } from './components'
import { statisticsHistory } from './statistics'
import { useWorkbench } from './useWorkbench'

export function DeliveryStatistics() {
  const state = useWorkbench()
  const [days, setDays] = useState('7')
  const history = statisticsHistory(
    state.today,
    state.statistics,
    days === 'all' ? null : Number(days),
  )
  return (
    <section className="space-y-4 pt-4" aria-label="投递统计">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-44">
          <SelectField
            label="统计范围"
            value={days}
            onChange={setDays}
            options={[
              { value: '3', label: '近三日' },
              { value: '7', label: '近七日' },
              { value: '30', label: '近三十日' },
              { value: 'all', label: '全部历史' },
            ]}
          />
        </div>
        <p className="text-sm">成功投递 {history.reduce((sum, day) => sum + day.success, 0)}</p>
      </div>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label="历史投递统计">
            <Table.Header>
              <Table.Column isRowHeader>日期</Table.Column>
              <Table.Column>扫描</Table.Column>
              <Table.Column>成功</Table.Column>
              <Table.Column>重复</Table.Column>
              <Table.Column>活跃筛选</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => <p className="p-6 text-center text-muted">暂无统计</p>}
            >
              {history.map((day) => (
                <Table.Row key={day.date} id={day.date}>
                  <Table.Cell>{day.date}</Table.Cell>
                  <Table.Cell>{day.total}</Table.Cell>
                  <Table.Cell>{day.success}</Table.Cell>
                  <Table.Cell>{day.repeat}</Table.Cell>
                  <Table.Cell>{day.activityFilter}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </section>
  )
}

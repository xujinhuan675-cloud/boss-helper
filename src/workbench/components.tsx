/** @jsxImportSource react */
import { Button, Label, ListBox, Modal, Select, Tooltip, toast } from '@heroui/react'
import type { ReactNode } from 'react'

import { perform } from './store'

// Official HeroUI compositions shared by the business forms.
export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  placeholder,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
  hideLabel?: boolean
  placeholder?: string
}) {
  return (
    <Select
      aria-label={label}
      placeholder={placeholder}
      value={value || null}
      onChange={(key) => onChange(String(key ?? ''))}
      isDisabled={disabled}
      fullWidth
      className="min-w-0"
    >
      {!hideLabel && <Label>{label}</Label>}
      <Select.Trigger>
        <Select.Value className="truncate" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((item) => (
            <ListBox.Item key={item.value} id={item.value} textValue={item.label}>
              <span className="min-w-0 break-words">{item.label}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

export function IconButton({
  label,
  children,
  onPress,
  disabled = false,
}: {
  label: string
  children: ReactNode
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <Button
        isIconOnly
        aria-label={label}
        variant="ghost"
        size="sm"
        isDisabled={disabled}
        onPress={onPress}
      >
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = '确认',
  danger = false,
  disabled = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  danger?: boolean
  disabled?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(value) => {
        if (!value && !disabled) onClose()
      }}
      isDismissable={!disabled}
    >
      <Modal.Container>
        <Modal.Dialog>
          <Modal.CloseTrigger isDisabled={disabled} />
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" isDisabled={disabled} onPress={onClose}>
              取消
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              isDisabled={disabled}
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

export async function act(work: () => Promise<unknown>, success?: string) {
  try {
    await perform(work)
    if (success) toast.success(success)
    return true
  } catch (error) {
    toast.danger(error instanceof Error ? error.message : String(error))
    return false
  }
}

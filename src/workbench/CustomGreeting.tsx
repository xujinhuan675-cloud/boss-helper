/** @jsxImportSource react */
import { Button, Input, Label, Switch, TextArea, TextField } from '@heroui/react'
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { counter } from '@/message'
import type { CustomGreetingItem, FormData } from '@/types/formData'

import { act, IconButton } from './components'

function GreetingImage({
  image,
  index,
  disabled,
  onUpload,
}: {
  image: string
  index: number
  disabled: boolean
  onUpload: (file: File) => void
}) {
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    let url = ''
    setPreview('')
    setError('')
    if (image)
      void counter
        .getImage(image)
        .then((result) => {
          if (cancelled) return
          if (!result.success) {
            setError('图片不存在或已过期')
            return
          }
          url = URL.createObjectURL(
            new Blob([new Uint8Array(result.buffer)], { type: result.type }),
          )
          setPreview(url)
        })
        .catch(() => {
          if (!cancelled) setError('图片读取失败')
        })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [image])
  return (
    <div className="flex flex-col gap-2">
      {preview && (
        <img
          src={preview}
          alt={`招呼语图片 ${index + 1}`}
          className="max-h-48 max-w-full object-contain self-start"
        />
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <TextField isDisabled={disabled}>
        <Label>{image ? '更换图片' : '上传图片'}</Label>
        <Input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onUpload(file)
          }}
        />
      </TextField>
    </div>
  )
}

export function CustomGreeting({
  config,
  disabled,
  onChange,
}: {
  config: Pick<FormData, 'customGreeting' | 'greetingVariable' | 'aiGreeting'>
  disabled: boolean
  onChange: <K extends 'customGreeting' | 'greetingVariable'>(key: K, value: FormData[K]) => void
}) {
  const items: CustomGreetingItem[] =
    typeof config.customGreeting.value === 'string'
      ? [{ type: 'text', content: config.customGreeting.value }]
      : config.customGreeting.value

  function update(items: CustomGreetingItem[]) {
    onChange('customGreeting', { ...config.customGreeting, value: items })
  }

  function move(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= items.length) return
    const reordered = [...items]
    ;[reordered[index], reordered[next]] = [reordered[next]!, reordered[index]!]
    update(reordered)
  }

  async function uploadImage(index: number, file: File) {
    if (disabled) return
    await act(async () => {
      if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
      const image = await counter.setImage({
        name: file.name,
        type: file.type,
        buffer: Array.from(new Uint8Array(await file.arrayBuffer())),
      })
      if (!image.success || !image.key) throw new Error('图片上传失败')
      update(items.map((item, i) => (i === index ? { type: 'image', image: image.key } : item)))
    }, '图片已上传，保存招呼语后生效')
  }

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-5" aria-label="自定义招呼语">
      <h3 className="text-base font-semibold">自定义招呼语</h3>
      <Switch
        className="switch-row"
        isSelected={config.customGreeting.enable}
        onChange={(enable) => onChange('customGreeting', { ...config.customGreeting, enable })}
        isDisabled={disabled}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>启用自定义招呼语</Label>
        </Switch.Content>
      </Switch>
      <Switch
        className="switch-row"
        isSelected={config.greetingVariable.value}
        onChange={(value) => onChange('greetingVariable', { ...config.greetingVariable, value })}
        isDisabled={disabled}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>渲染招呼语变量</Label>
        </Switch.Content>
      </Switch>
      {config.aiGreeting.enable && (
        <p className="text-sm text-muted">
          当前 AI 招呼语已启用，自定义文字招呼语将由 AI 生成内容替代。
        </p>
      )}
      {typeof config.customGreeting.value === 'string' ? (
        <TextField
          value={config.customGreeting.value}
          onChange={(value) => onChange('customGreeting', { ...config.customGreeting, value })}
          isDisabled={disabled}
        >
          <Label>招呼语正文</Label>
          <TextArea rows={6} />
        </TextField>
      ) : (
        items.map((item, index) => (
          <section
            key={index}
            className="flex flex-col gap-3"
            aria-label={`自定义消息 ${index + 1}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">
                消息 {index + 1} · {item.type === 'image' ? '图片' : '文字'}
              </h4>
              <div className="flex gap-1">
                <IconButton
                  label={`自定义消息 ${index + 1} 上移`}
                  disabled={disabled || index === 0}
                  onPress={() => move(index, -1)}
                >
                  <ArrowUp size={16} />
                </IconButton>
                <IconButton
                  label={`自定义消息 ${index + 1} 下移`}
                  disabled={disabled || index === items.length - 1}
                  onPress={() => move(index, 1)}
                >
                  <ArrowDown size={16} />
                </IconButton>
                <IconButton
                  label={`删除自定义消息 ${index + 1}`}
                  disabled={disabled}
                  onPress={() => update(items.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </div>
            {item.type === 'text' ? (
              <TextField
                aria-label={`自定义消息 ${index + 1} 文字`}
                value={item.content}
                isDisabled={disabled}
                onChange={(content) =>
                  update(
                    items.map((message, i) => (i === index ? { type: 'text', content } : message)),
                  )
                }
              >
                <TextArea rows={4} />
              </TextField>
            ) : (
              <GreetingImage
                image={item.image}
                index={index}
                disabled={disabled}
                onUpload={(file) => {
                  void uploadImage(index, file)
                }}
              />
            )}
          </section>
        ))
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          isDisabled={disabled}
          onPress={() => update([...items, { type: 'text', content: '' }])}
        >
          <Plus size={16} />
          添加文字
        </Button>
        <Button
          variant="secondary"
          isDisabled={disabled}
          onPress={() => update([...items, { type: 'image', image: '' }])}
        >
          <ImagePlus size={16} />
          添加图片
        </Button>
      </div>
    </section>
  )
}

export async function stitchJobScreenshots(
  first: string,
  second: string,
  scrollDelta: number,
  viewportHeight: number,
): Promise<string> {
  const images: ImageBitmap[] = []
  try {
    for (const dataUrl of [first, second])
      images.push(await createImageBitmap(await (await fetch(dataUrl)).blob()))
    const [top, bottom] = images
    if (!top || !bottom || top.width !== bottom.width || top.height !== bottom.height)
      throw new Error('截图尺寸已改变，请重试')
    const addedHeight = Math.round((scrollDelta / viewportHeight) * top.height)
    if (addedHeight <= 0 || addedHeight > top.height) throw new Error('截图滚动距离无效')
    const canvas = new OffscreenCanvas(top.width, top.height + addedHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法拼接岗位截图')
    context.drawImage(top, 0, 0)
    context.drawImage(
      bottom,
      0,
      bottom.height - addedHeight,
      bottom.width,
      addedHeight,
      0,
      top.height,
      bottom.width,
      addedHeight,
    )
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    )
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return `data:image/png;base64,${btoa(binary)}`
  } finally {
    for (const image of images) image.close()
  }
}

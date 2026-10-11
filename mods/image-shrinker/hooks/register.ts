import type { EngineInterface, Register } from 'claude-code'

const MAX_WIDTH = 1200
// The API downscales any image whose long edge is over 1568px, which would make the scale note wrong.
const MAX_HEIGHT = 1568
// It also downscales anything over about 1568 visual tokens (width x height / 750), roughly 1.15 megapixels.
const MAX_PIXELS = 1_150_000
// Where the downscaled copies go, private to the user; the original is never touched.
const DIR = '/tmp/claude-shrunk'
// sips reads these; anything else (svg, pdf) is passed through.
const IMAGE = /\.(png|jpe?g|gif|tiff?|bmp|webp|heic|heif)$/i
// The API cannot show these, so they are always converted, whatever their size.
const CONVERT = /\.(heic|heif)$/i
// A JPEG stays a JPEG: PNG would make a photo several times bigger.
const JPEG = /\.jpe?g$/i

// The pixel size of an image, or undefined when sips cannot read it or is missing (sips ships only with macOS).
async function sizeOf($: EngineInterface, path: string) {
  const ran = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path]).catch(() => undefined)
  if (ran === undefined) return undefined
  const width = Number(/pixelWidth:\s*(\d+)/.exec(ran.stdout)?.[1])
  const height = Number(/pixelHeight:\s*(\d+)/.exec(ran.stdout)?.[1])

  return ran.exitCode === 0 && width > 0 && height > 0 ? { width, height } : undefined
}

// Makes a private copy for this one read. Undefined means "read the original": no sips, not shrinkable, or anything went wrong.
async function shrink($: EngineInterface, path: string) {
  const size = await sizeOf($, path)
  if (size === undefined) return undefined
  const scale = Math.min(MAX_WIDTH / size.width, MAX_HEIGHT / size.height, Math.sqrt(MAX_PIXELS / (size.width * size.height)), 1)
  if (scale === 1 && !CONVERT.test(path)) return undefined

  // Every read gets its own copy, so two reads of one path (or two sessions) never share a file.
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const format = JPEG.test(path) ? 'jpeg' : 'png'
  const copy = `${DIR}/${unique}${path.replace(/[^A-Za-z0-9.]+/g, '_').slice(-80)}.${format === 'jpeg' ? 'jpg' : 'png'}`
  // The copy is outside the project, so check it would be read without a prompt too; otherwise every screenshot would ask.
  const copyVerdict = await $.tool.check({ tool: 'Read', input: { file_path: copy } }).catch(() => undefined)
  if (copyVerdict?.decision !== 'allow') return undefined
  // Round down so the final size is never over a cap.
  const width = Math.max(1, Math.floor(size.width * scale))
  const height = Math.max(1, Math.floor(size.height * scale))
  // Folder 0700 and copy 0600: other users on the Mac cannot read them. chmod fails on a folder someone else made.
  const dir = await $.process.run(['mkdir', '-p', '-m', '700', DIR])
  if (dir.exitCode !== 0 || (await $.process.run(['chmod', '700', DIR])).exitCode !== 0) return undefined
  const made = await $.process.run(['sips', '-z', String(height), String(width), path, '-s', 'format', format, '--out', copy])
  if (made.exitCode === 0 && (await $.process.run(['chmod', '600', copy])).exitCode === 0) return { copy, size, scale, width, height }
  await $.process.run(['rm', '-f', copy])

  return undefined
}

export const register: Register = on => {
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    // An offset on an image asks for the original.
    if (!IMAGE.test(e.file_path) || e.offset !== undefined) return next(e)
    // Ask the permission rules about the real file first. Only an "allow" is shrunk; an ask or deny goes the normal way on the original path.
    const verdict = await $.tool.check({ tool: 'Read', input: { file_path: e.file_path } }).catch(() => undefined)
    if (verdict?.decision !== 'allow') return next(e)
    const small = await shrink($, e.file_path).catch(() => undefined)
    if (small === undefined) return next(e)
    const { copy, size, width, height } = small

    const ran = await next({ ...e, file_path: copy }).finally(() => $.process.run(['rm', '-f', copy]).catch(() => undefined))
    if (ran.deny !== undefined || (width === size.width && height === size.height)) return ran

    return {
      ...ran,
      context: [
        ...(ran.context ?? []),
        `image-shrinker: ${e.file_path} is ${size.width}x${size.height}px; this view is ${width}x${height}px. To get original image pixels, multiply positions read off this view by ${(size.width / width).toFixed(2)}. That is not the same as page or screen click positions (a Retina screen has two image pixels per page pixel). To see the original, Read it again with offset: 1.`,
      ],
    }
  })
}

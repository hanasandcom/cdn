import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, stat, statfs, rm } from 'node:fs/promises'
import { join } from 'node:path'
import run from '#db'
import sharp from 'sharp'
import { reserveBytes, storageDirectory, storagePath, storeVideoDerivative, StorageError } from './fileStorage.ts'

const execute = promisify(execFile)
const MiB = 1024 * 1024
const maxPlaybackBytes = 512 * MiB
const inputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,ogg,mpegts,mpeg,mpegvideo']
const jobs = new Map<string, { sourceKey: string | null, playback: boolean }>()
const waiting: string[] = []
const failures = new Map<string, number>()
let running = false

export const isVideo = (type: string) => type.toLowerCase().startsWith('video/')

export async function probeVideo(path: string) {
    const { stdout } = await execute('ffprobe', ['-v', 'error', ...inputOptions,
        '-show_streams', '-show_format', '-of', 'json', path], { timeout: 15_000, maxBuffer: MiB })
    const probe = JSON.parse(stdout)
    const stream = probe.streams?.find((item: { codec_type: string }) => item.codec_type === 'video')
    const duration = Number(probe.format?.duration || stream?.duration)
    if (!stream || !Number.isFinite(duration) || duration <= 0
        || !stream.width || !stream.height || stream.width > 8192 || stream.height > 8192) {
        throw Error('This video cannot be previewed within the processing limits.')
    }
    return { duration, stream, streams: probe.streams }
}

export async function createVideoDerivative(input: string, output: string, variant: 'thumbnail' | 'playback') {
    const source = await probeVideo(input)
    if (variant === 'playback' && (source.duration > 3600 || (await stat(input)).size > 2 * 1024 * MiB)) {
        throw Error('This video exceeds the playback conversion limits; download the original instead.')
    }
    const common = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-max_alloc', String(64 * MiB),
        ...inputOptions, '-threads', '2', '-i', input, '-map', '0:v:0', '-sn', '-dn', '-filter_threads', '1']
    const options = variant === 'thumbnail'
        ? ['-frames:v', '1', '-vf', 'scale=480:480:force_original_aspect_ratio=decrease',
            '-an', '-c:v', 'png', '-threads', '2', '-f', 'image2']
        : ['-map', '0:a:0?', '-vf', 'scale=w=\'min(1280,iw)\':h=\'min(720,ih)\':force_original_aspect_ratio=decrease:force_divisible_by=2',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M',
            '-pix_fmt', 'yuv420p', '-r', '30', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
            '-movflags', '+faststart', '-fs', String(maxPlaybackBytes), '-f', 'mp4']
    const encodedOutput = variant === 'thumbnail' ? `${output}.png` : output
    try {
        await execute('ffmpeg', [...common, ...options, encodedOutput], {
            timeout: variant === 'thumbnail' ? 30_000 : 10 * 60_000, killSignal: 'SIGKILL', maxBuffer: MiB,
        })
        if (variant === 'thumbnail') {
            const poster = await sharp(await readFile(encodedOutput), { limitInputPixels: 480 * 480 })
                .webp({ quality: 75 }).toBuffer()
            await writeFile(output, poster, { flag: 'wx', mode: 0o600 })
        }
    } finally {
        if (variant === 'thumbnail') await rm(encodedOutput, { force: true })
    }
    const bytes = (await stat(output)).size
    if (!bytes || bytes > (variant === 'thumbnail' ? 2 * MiB : maxPlaybackBytes)) throw Error('Video preview exceeds its size limit.')
    if (variant === 'playback') {
        const result = await probeVideo(output)
        // -fs may terminate successfully with a truncated movie. Never publish that as a complete preview.
        if (Math.abs(result.duration - source.duration) > Math.max(1, source.duration * 0.01)
            || result.stream.codec_name !== 'h264' || result.stream.pix_fmt !== 'yuv420p'
            || result.streams.some((stream: { codec_type: string, codec_name: string }) =>
                stream.codec_type === 'audio' && stream.codec_name !== 'aac')) {
            throw Error('The generated video preview failed verification.')
        }
    }
}

async function processVideo(id: string, job: { sourceKey: string | null, playback: boolean }) {
    const result = await run(`SELECT id,type,data,storage_key,thumbnail_storage_key,playback_storage_key
        FROM files WHERE id=$1 AND deleted_at IS NULL AND purge_started_at IS NULL`, [id])
    const file = result.rows[0]
    if (!file || file.storage_key !== job.sourceKey || !isVideo(file.type)) return
    const sourceBytes = file.storage_key ? (await stat(storagePath(file.storage_key))).size : file.data.length
    const disk = await statfs(storageDirectory)
    const workingBytes = (job.playback ? maxPlaybackBytes : 2 * MiB) + (file.storage_key ? 0 : sourceBytes) + 2 * MiB
    if (disk.bavail * disk.bsize < reserveBytes + workingBytes) {
        throw new StorageError(507, 'Video previews are paused because disk space is low.')
    }
    const directory = await mkdtemp(join(storageDirectory, '.video-work-'))
    try {
        const source = file.storage_key ? storagePath(file.storage_key) : join(directory, 'original')
        if (!file.storage_key) await writeFile(source, file.data, { flag: 'wx', mode: 0o600 })
        if (!file.thumbnail_storage_key) {
            const poster = join(directory, 'poster.webp')
            await createVideoDerivative(source, poster, 'thumbnail')
            await storeVideoDerivative(id, file.storage_key, 'thumbnail', poster)
        }
        if (job.playback && !file.playback_storage_key) {
            const available = await statfs(storageDirectory)
            if (available.bavail * available.bsize < reserveBytes + maxPlaybackBytes) {
                throw new StorageError(507, 'Video previews are paused because disk space is low.')
            }
            const playback = join(directory, 'playback.mp4')
            await createVideoDerivative(source, playback, 'playback')
            await storeVideoDerivative(id, file.storage_key, 'playback', playback)
        }
    } finally { await rm(directory, { recursive: true, force: true }) }
}

async function drain(log: { warn: (data: object, message: string) => void }) {
    if (running) return
    running = true
    try {
        while (waiting.length) {
            const id = waiting.shift()!
            const job = jobs.get(id)!
            try { await processVideo(id, job) } catch (error) {
                failures.set(id, Date.now() + 60_000)
                if (failures.size > 256) failures.delete(failures.keys().next().value!)
                log.warn({ error, fileId: id }, 'Video preview generation failed')
            } finally { jobs.delete(id) }
        }
    } finally { running = false }
}

// One encoder and at most sixteen queued IDs; no original buffers are retained in the queue.
export function requestVideoMedia(
    file: { id: string, storage_key: string | null }, variant: 'thumbnail' | 'playback',
    log: { warn: (data: object, message: string) => void },
): 'pending' | 'busy' | 'failed' {
    if ((failures.get(file.id) || 0) > Date.now()) return 'failed'
    failures.delete(file.id)
    const job = jobs.get(file.id)
    if (job) {
        if (variant === 'playback') job.playback = true
        return 'pending'
    }
    if (jobs.size >= 16) return 'busy'
    jobs.set(file.id, { sourceKey: file.storage_key, playback: variant === 'playback' })
    waiting.push(file.id)
    void drain(log)
    return 'pending'
}

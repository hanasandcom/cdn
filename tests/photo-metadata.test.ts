import { describe, expect, test } from 'bun:test'
import { readPhotoMetadata } from '../src/utils/photoMetadata.ts'

const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=',
    'base64',
)

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    return crc >>> 0
})

function crc32(data: Buffer) {
    let crc = 0xffffffff
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

function textChunk(key: string, value: Buffer | string) {
    const type = Buffer.from('tEXt')
    const text = Buffer.isBuffer(value) ? value : Buffer.from(value, 'latin1')
    const data = Buffer.concat([Buffer.from(key), Buffer.from([0]), text])
    const chunk = Buffer.alloc(12 + data.length)
    chunk.writeUInt32BE(data.length, 0)
    type.copy(chunk, 4)
    data.copy(chunk, 8)
    chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length)
    return chunk
}

function pngWithText(chunks: Buffer[]) {
    const end = basePng.length - 12
    return Buffer.concat([basePng.subarray(0, end), ...chunks, basePng.subarray(end)])
}

describe('photo metadata extraction', () => {
    test('reads capture date, timezone, and GPS from PNG text metadata', () => {
        const data = pngWithText([
            textChunk('DateTimeOriginal', '2025:06:05 12:34:56'),
            textChunk('OffsetTimeOriginal', '+02:00'),
            textChunk('GPSLatitude', '60, 10, 20 N'),
            textChunk('GPSLongitude', '10.75'),
            textChunk('City', 'Gjøvik'),
        ])

        expect(readPhotoMetadata(data, 'image/png')).toEqual({
            photoTakenAt: new Date('2025-06-05T10:34:56.000Z'),
            photoTakenOffsetMinutes: 120,
            locationLabel: 'Gjøvik',
            latitude: 60 + 10 / 60 + 20 / 3600,
            longitude: 10.75,
        })
    })

    test('finds metadata after the previous 8 MiB parsing cutoff', () => {
        const padding = Buffer.alloc(8 * 1024 * 1024, 0x61)
        const data = pngWithText([
            textChunk('Comment', padding),
            textChunk('DateTimeOriginal', '2025:06:05 12:34:56'),
            textChunk('GPSLatitude', '60.5 N'),
            textChunk('GPSLongitude', '10.75 E'),
        ])

        expect(data.length).toBeGreaterThan(8 * 1024 * 1024)
        expect(readPhotoMetadata(data, 'image/png')).toMatchObject({
            photoTakenAt: new Date('2025-06-05T12:34:56.000Z'),
            latitude: 60.5,
            longitude: 10.75,
        })
    })

    test('ignores non-image files', () => {
        expect(readPhotoMetadata(Buffer.from('metadata'), 'video/mp4')).toEqual({
            photoTakenAt: null,
            photoTakenOffsetMinutes: null,
            locationLabel: null,
            latitude: null,
            longitude: null,
        })
    })
})

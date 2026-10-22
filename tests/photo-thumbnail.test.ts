import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { createPhotoThumbnail } from '../src/utils/photoThumbnail.ts'

describe('photo thumbnails', () => {
    test('creates an orientation-safe WebP square sized for the gallery grid', async () => {
        const image = await sharp({
            create: { width: 1200, height: 800, channels: 3, background: { r: 36, g: 82, b: 124 } },
        }).jpeg().toBuffer()
        const thumbnail = await createPhotoThumbnail(image, 'image/jpeg')

        expect(thumbnail).not.toBeNull()
        const metadata = await sharp(thumbnail!).metadata()
        expect(metadata.format).toBe('webp')
        expect(metadata.width).toBe(480)
        expect(metadata.height).toBe(480)
    })

    test('skips unsupported and already-small images', async () => {
        const image = await sharp({
            create: { width: 320, height: 240, channels: 3, background: '#224466' },
        }).png().toBuffer()

        expect(await createPhotoThumbnail(image, 'image/png')).toBeNull()
        expect(await createPhotoThumbnail(image, 'video/mp4')).toBeNull()
    })
})

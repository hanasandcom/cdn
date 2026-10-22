import sharp from 'sharp'

const supportedImageType = /^image\/(jpeg|png|gif|webp|avif|heic|heif|tiff)$/i
const thumbnailEdge = 480

export async function createPhotoThumbnail(data: Buffer, type: string): Promise<Buffer | null> {
    if (!supportedImageType.test(type)) return null

    try {
        const input = sharp(data, { limitInputPixels: 100_000_000, sequentialRead: true })
        const metadata = await input.metadata()
        if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) <= thumbnailEdge) return null

        const thumbnail = await sharp(data, { limitInputPixels: 100_000_000, sequentialRead: true })
            .rotate()
            .resize(thumbnailEdge, thumbnailEdge, {
                fit: 'cover', position: 'attention', withoutEnlargement: true,
            })
            .webp({ quality: 78, effort: 4 })
            .timeout({ seconds: 5 })
            .toBuffer()
        return thumbnail.length <= 2 * 1024 * 1024 ? thumbnail : null
    } catch {
        return null
    }
}

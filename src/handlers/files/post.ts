import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import { persistFile, maxFileBytes, StorageError } from '#utils/fileStorage.ts'
import { beginUpload } from '#utils/uploadGuard.ts'

export default async function postFile(req: FastifyRequest, res: FastifyReply) {
    const user = typeof req.headers.id === 'string' ? req.headers.id : ''
    const auth = await tokenWrapper(user, req.headers.authorization?.split(' ')[1] || '')
    if (!auth.status || !auth.id) return res.status(401).send({ error: 'Sign in to upload files.' })
    if (!req.isMultipart()) return res.status(400).send({ error: 'Request is not multipart' })
    let finish: (() => void) | undefined
    try {
        finish = beginUpload(auth.id)
        const fields: Record<string, string> = {}
        let data: Buffer | undefined
        for await (const part of req.parts({ limits: { fileSize: maxFileBytes, files: 1, fields: 4, parts: 5 } })) {
            if (part.type === 'file') data = await part.toBuffer()
            else if (['name', 'description', 'path', 'type'].includes(part.fieldname)) fields[part.fieldname] = String(part.value)
        }
        if (!fields.name || !data) return res.status(400).send({ error: 'Missing name or file.' })
        if (fields.name.length > 255 || /[\r\n\0]/.test(fields.name)) return res.status(400).send({ error: 'Invalid file name.' })
        if ((fields.description?.length || 0) > 1024) return res.status(400).send({ error: 'Description is too long.' })
        if ((fields.path?.length || 0) > 180 || /[\r\n\0]/.test(fields.path || '')) {
            return res.status(400).send({ error: 'Invalid file path.' })
        }
        const type = fields.type || 'application/octet-stream'
        if (type.length > 120 || !/^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w=.+-]+)*$/.test(type)) {
            return res.status(400).send({ error: 'Invalid file type.' })
        }
        const id = randomUUID()
        const path = fields.path || id
        await persistFile(auth.id, data, async (client, key) => {
            await client.query(`INSERT INTO files (id,name,description,data,path,type,owner,storage_key,storage_size)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [id, fields.name, fields.description || null, Buffer.alloc(0), path, type, auth.id, key, data!.length])
        })
        return res.send({ id, path, owner: auth.id })
    } catch (error) {
        const e = error as Error & { statusCode?: number, code?: string }
        if (e.code === '23505') return res.status(409).send({ error: 'That file path is already taken.' })
        if (error instanceof StorageError || e.statusCode === 413) return res.status(e.statusCode || 413).send({ error: e.message })
        req.log.error({ error }, 'Upload failed')
        return res.status(500).send({ error: 'Upload failed.' })
    } finally { finish?.() }
}

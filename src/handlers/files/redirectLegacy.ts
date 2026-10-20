import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function redirectLegacyFile(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    return res.header('Cache-Control', 'no-store').redirect(`/api/files/${encodeURIComponent(id)}`, 308)
}

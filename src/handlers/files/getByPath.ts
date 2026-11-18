import type { FastifyReply, FastifyRequest } from 'fastify'
import { getFileByIdentifier } from './get.ts'

export default async function getFileByPath(req: FastifyRequest, res: FastifyReply) {
    return getFileByIdentifier(req, res, 'path')
}

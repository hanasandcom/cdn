import type { FastifyInstance } from 'fastify'
import getIndex from './handlers/index/get.ts'
import getFile from './handlers/files/get.ts'
import putFile from './handlers/files/put.ts'
import postFile from './handlers/files/post.ts'
import postBulkFiles from './handlers/files/postBulk.ts'
import deleteFile from './handlers/files/delete.ts'
import getFileByPath from './handlers/files/getByPath.ts'
import getUserFiles from './handlers/files/getUserFiles.ts'
import getShare from './handlers/shares/get.ts'
import putShare from './handlers/shares/put.ts'
import postShare from './handlers/shares/post.ts'
import deleteShare from './handlers/shares/delete.ts'
import checkPath from './handlers/files/checkPath.ts'
import getLink from './handlers/links/get.ts'
import putLink from './handlers/links/put.ts'
import postLink from './handlers/links/post.ts'
import getWords from './handlers/words/get.ts'
import getTree from './handlers/shares/getTree.ts'
import getBlockList from './handlers/blocklist/get.ts'
import getBlockListForNginx from './handlers/blocklist/getBlockListForNginx.ts'
import getBlockListOverview from './handlers/blocklist/getBlocklistOverview.ts'
import getRequestMetrics from './handlers/requests/getRequestMetrics.ts'
import getRequestLogs from './handlers/requests/getLog.ts'
import postBlockList from './handlers/blocklist/post.ts'
import editBlockList from './handlers/blocklist/put.ts'
import deleteBlocklist from './handlers/blocklist/delete.ts'
import postRequest from './handlers/traffic/post.ts'
import getIPMetrics from './handlers/traffic/getIPMetrics.ts'
import getUAMetrics from './handlers/traffic/getUAMetrics.ts'
import getDomainTPS from './handlers/traffic/getDomainTPS.ts'
import lockShare from './handlers/shares/lock.ts'
import getProject from './handlers/project/get.ts'
import lockProject from './handlers/project/lock.ts'
import unlockProject from './handlers/project/unlock.ts'
import deleteProject from './handlers/project/delete.ts'
import getUserShares from './handlers/shares/getUserShares.ts'
import getUserProjects from './handlers/project/getUserProjects.ts'
import getShareEditors from './handlers/shares/getShareEditors.ts'
import getProjectEditors from './handlers/project/getProjectEditors.ts'
import addProjectEditors from './handlers/project/addProjectEditors.ts'
import addShareEditors from './handlers/shares/addShareEditors.ts'
import removeProjectEditors from './handlers/project/removeProjectEditors.ts'
import removeShareEditors from './handlers/shares/removeShareEditors.ts'
import listProjectsInGroup from './handlers/project/groups/get.ts'
import addProjectsToGroup from './handlers/project/groups/addProjectToGroup.ts'
import removeProjectsFromGroup from './handlers/project/groups/removeProjectFromGroup.ts'
import deleteProjectGroup from './handlers/project/groups/deleteGroup.ts'
import listGroupsByOwner from './handlers/project/groups/listGroupsByOwner.ts'
import listGroupsByEditor from './handlers/project/groups/listGroupsByEditor.ts'
import createProjectGroup from './handlers/project/groups/post.ts'
import getProjects from './handlers/project/getProjects.ts'
import getInstall from './handlers/index/install.ts'

export default async function apiRoutes(fastify: FastifyInstance) {
    // index
    fastify.get('/', getIndex)

    // install.sh
    fastify.get('/install.sh', getInstall)

    // files
    fastify.get('/files/check', checkPath)
    fastify.get('/files/path/:id', getFileByPath)
    fastify.get('/files/user/:id', getUserFiles)
    fastify.get('/files/:id', getFile)
    fastify.put('/files/:id', putFile)
    fastify.post('/files', postFile)
    fastify.post('/files/bulk', postBulkFiles)
    fastify.delete('/files/:id', deleteFile)

    // share
    fastify.get('/share/:id', getShare)
    fastify.get('/share/tree/:id', getTree)
    fastify.get('/share/user/:id', getUserShares)
    fastify.get('/share/editors/:id', getShareEditors)
    fastify.get('/share/editors/add/:id', addShareEditors)
    fastify.get('/share/editors/remove/:id', removeShareEditors)
    fastify.get('/share/lock/:id', lockShare)
    fastify.put('/share/:id', putShare)
    fastify.post('/share', postShare)
    fastify.delete('/share/:id', deleteShare)

    // project
    fastify.get('/project/:alias', getProject)
    fastify.get('/projects', getProjects)
    fastify.get('/projects/user/:id', getUserProjects)
    fastify.get('/project/editors/add/:id', addProjectEditors)
    fastify.get('/project/editors/remove/:id', removeProjectEditors)
    fastify.get('/project/editors/:id', getProjectEditors)
    fastify.get('/project/lock/:alias', lockProject)
    fastify.get('/project/unlock/:alias', unlockProject)
    fastify.delete('/project/:alias', deleteProject)

    // project groups
    fastify.get('/project/group/owner/:id', listGroupsByOwner)
    fastify.get('/project/group/editor/:id', listGroupsByEditor)
    fastify.get('/project/group/:id', listProjectsInGroup)
    fastify.post('/project/group/:id', createProjectGroup)
    fastify.post('/project/group/add/:id', addProjectsToGroup)
    fastify.post('/project/group/remove/:id', removeProjectsFromGroup)
    fastify.delete('/project/group/:id', deleteProjectGroup)

    // links
    fastify.get('/link/:id', getLink)
    fastify.put('/link/:id', putLink)
    fastify.post('/link/:id', postLink)

    // words
    fastify.get('/words', getWords)

    // blocklist
    fastify.get('/blocklist', getBlockList)
    fastify.get('/blocklist/overview', getBlockListOverview)
    fastify.get('/blocklist/nginx', getBlockListForNginx)
    fastify.post('/blocklist', postBlockList)
    fastify.put('/blocklist/:id', editBlockList)
    fastify.delete('/blocklist/:id', deleteBlocklist)

    // requests
    fastify.get('/traffic/tps', getDomainTPS)
    fastify.get('/traffic/ips', getIPMetrics)
    fastify.get('/traffic/uas', getUAMetrics)
    fastify.get('/traffic/recent', getRequestLogs)
    fastify.get('/traffic/summary', getRequestMetrics)
    fastify.post('/traffic', postRequest)
}

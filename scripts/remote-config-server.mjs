/**
 * Reads a Firebase project's server-side Remote Config template (read only).
 *
 * Neither gcloud nor the Firebase CLI can read server templates, so this uses the
 * Admin SDK. It signs in with application default credentials, so run
 * `gcloud auth application-default login` once on a new machine.
 *
 * Usage:
 *   node ~/.claude/scripts/remote-config-server.mjs <projectId>             all parameters
 *   node ~/.claude/scripts/remote-config-server.mjs <projectId> <parameter> one value
 *
 * A JSON value is pretty-printed. The template version goes to stderr.
 */

import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getRemoteConfig } from 'firebase-admin/remote-config'

const [projectId, parameterName] = process.argv.slice(2)

if (!projectId) {
  console.error('Usage: node remote-config-server.mjs <projectId> [parameter]')
  process.exit(1)
}

// A user login gets a 403 from Remote Config unless requests name a quota project.
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId

initializeApp({ credential: applicationDefault(), projectId })

const template = await getRemoteConfig().getServerTemplate()
const { parameters, version } = template.toJSON()

const updated = version?.updateTime ? `, updated ${version.updateTime}` : ''
console.error(`Server template version ${version?.versionNumber}${updated}`)

if (!parameterName) {
  console.log(JSON.stringify(parameters, null, 2))
  process.exit(0)
}

if (!(parameterName in parameters)) {
  console.error(`No parameter named ${parameterName}: ${Object.keys(parameters).join(', ')}`)
  process.exit(1)
}

const value = template.evaluate().getString(parameterName)

try {
  console.log(JSON.stringify(JSON.parse(value), null, 2))
} catch {
  console.log(value)
}

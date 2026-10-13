// sommelier hooks module.
// Skeleton only: registers the /somm command. Routing logic arrives with the
// prototype (see docs/spec.md「開發順序」).

const COMMAND = 'somm'
const FALLBACK_COMMAND = 'sommelier'

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'sommelier: on|off|status|export|config',
        argumentHint: '[on|off|status|export|config]',
        immediate: true,
      })
    } catch {
      // /somm is taken: register the long name instead and say so.
      await $.command.register({
        name: FALLBACK_COMMAND,
        description: 'sommelier: on|off|status|export|config',
        argumentHint: '[on|off|status|export|config]',
        immediate: true,
      })
      $.ui.toast('/somm is taken; use /sommelier instead')
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    return { text: 'sommelier is not implemented yet (args: ' + (e.args || '-') + ')' }
  })

  on('command.run', { command: FALLBACK_COMMAND }, async ($, e) => {
    return { text: 'sommelier is not implemented yet (args: ' + (e.args || '-') + ')' }
  })
}

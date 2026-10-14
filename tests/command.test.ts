import { expect, mock, test } from 'claude-code/testing'

test('/somm is registered and answers', async ($, on) => {
  const registered: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: undefined }
  })
  on('store.get', () => ({ value: undefined }))
  on('session.root', () => ({ value: '/work' }))
  mock.env(on, {})

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['somm'])

  const answer = await $.command.run({ command: 'somm', args: 'status' })
  expect(answer.text).toContain('sommelier')
})

test('falls back to /sommelier when /somm is taken', async ($, on) => {
  const registered: string[] = []
  const toasts: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    if (e.name === 'somm') return { deny: '"/somm" refused: taken' }
    registered.push(e.name)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['sommelier'])
  expect(toasts.length).toBe(1)
})

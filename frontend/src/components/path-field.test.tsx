// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { PathField } from '@/components/path-field'
import { api, ApiRequestError } from '@/lib/api'
import type { DirectoryEntry, DirectoryListing } from '@/types'

function entry(name: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    name,
    path: `/home/you/adventures/${name}`,
    display_path: `~/adventures/${name}`,
    is_directory: true,
    project_type: null,
    ...overrides,
  }
}

function listing(overrides: Partial<DirectoryListing> = {}): DirectoryListing {
  return {
    path: '/home/you/adventures',
    display_path: '~/adventures',
    parent: '/home/you',
    home: '/home/you',
    entries: [
      entry('mill.osr', { project_type: 'native' }),
      entry('cellar.forge', { project_type: 'forge' }),
      entry('notes.md', { is_directory: false }),
      entry('module.pdf', { is_directory: false }),
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

function renderField(props: Partial<React.ComponentProps<typeof PathField>> = {}) {
  const onChange = vi.fn()
  render(
    <PathField
      id="test-path"
      kind="directory"
      title="Choose a project directory"
      value=""
      onChange={onChange}
      {...props}
    />,
  )
  return onChange
}

async function openPicker(props: Partial<React.ComponentProps<typeof PathField>> = {}) {
  const onChange = renderField(props)
  fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
  expect(await screen.findByTestId('picker-location')).toHaveTextContent('~/adventures')
  return onChange
}

test('the field still takes a typed path, tilde and all', () => {
  const onChange = renderField()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '~/adventures/mill.osr' } })
  expect(onChange).toHaveBeenCalledWith('~/adventures/mill.osr')
})

test('browsing opens on the field value and lists the directory', async () => {
  const browse = vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker({ value: '~/adventures/mill.osr' })
  expect(browse).toHaveBeenCalledWith('~/adventures/mill.osr', false, 'test-path')
  expect(screen.getByText('mill.osr')).toBeInTheDocument()
  // Project shape is on the entry, so a workdir is recognizable before opening it.
  expect(screen.getByText('forge')).toBeInTheDocument()
})

test('a directory field lists no files at all', async () => {
  vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker()
  expect(screen.queryByText('notes.md')).not.toBeInTheDocument()
  expect(screen.queryByText('module.pdf')).not.toBeInTheDocument()
})

test('a file field lists the suffixes it named, and every directory', async () => {
  vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker({ kind: 'file', suffixes: ['.pdf'] })
  expect(screen.getByText('module.pdf')).toBeInTheDocument()
  expect(screen.queryByText('notes.md')).not.toBeInTheDocument()
  // Directories are never filtered away — they are how you reach the file.
  expect(screen.getByText('mill.osr')).toBeInTheDocument()
})

test('clicking a directory navigates and moves the path box with it', async () => {
  const browse = vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker()
  browse.mockResolvedValue(
    listing({ path: '/home/you/adventures/mill.osr', display_path: '~/adventures/mill.osr' }),
  )
  fireEvent.click(screen.getByText('mill.osr'))
  await waitFor(() =>
    expect(screen.getByTestId('picker-location')).toHaveTextContent('~/adventures/mill.osr'),
  )
  expect(browse).toHaveBeenLastCalledWith('/home/you/adventures/mill.osr', false)
  expect(screen.getByLabelText('Path')).toHaveValue('~/adventures/mill.osr')
})

test('a file field lands on a directory with a separator waiting for the name', async () => {
  const browse = vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker({ kind: 'file' })
  browse.mockResolvedValue(
    listing({ path: '/home/you/exports', display_path: '~/exports', entries: [] }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Up one directory' }))
  await waitFor(() => expect(screen.getByLabelText('Path')).toHaveValue('~/exports/'))
})

test('the opening browse never rewrites what the user typed', async () => {
  // The value names a file that may not exist yet; the browse lands on its
  // nearest existing ancestor, and the field's own text must survive that.
  vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker({ kind: 'file', value: '~/adventures/not-yet.json' })
  expect(screen.getByLabelText('Path')).toHaveValue('~/adventures/not-yet.json')
})

test('clicking a file fills the path box with its tilde-shortened path', async () => {
  vi.spyOn(api, 'browse').mockResolvedValue(listing())
  const onChange = await openPicker({ kind: 'any' })
  fireEvent.click(screen.getByText('notes.md'))
  expect(screen.getByLabelText('Path')).toHaveValue('~/adventures/notes.md')
  fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
  expect(onChange).toHaveBeenCalledWith('~/adventures/notes.md')
})

test('home browses with no path at all', async () => {
  const browse = vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker({ value: '~/adventures' })
  fireEvent.click(screen.getByRole('button', { name: 'Home' }))
  await waitFor(() => expect(browse).toHaveBeenLastCalledWith(null, false))
})

test('up is disabled at the filesystem root', async () => {
  vi.spyOn(api, 'browse').mockResolvedValue(listing({ parent: null }))
  await openPicker()
  expect(screen.getByRole('button', { name: 'Up one directory' })).toBeDisabled()
})

test('the hidden toggle re-browses the same directory', async () => {
  const browse = vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker()
  fireEvent.click(screen.getByLabelText('Show hidden'))
  await waitFor(() => expect(browse).toHaveBeenLastCalledWith('/home/you/adventures', true))
})

test('choosing hands back whatever the path box holds, existing or not', async () => {
  vi.spyOn(api, 'browse').mockResolvedValue(listing())
  const onChange = await openPicker()
  fireEvent.change(screen.getByLabelText('Path'), {
    target: { value: '~/adventures/brand-new.osr' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
  expect(onChange).toHaveBeenCalledWith('~/adventures/brand-new.osr')
})

test('an empty field opens on the scope, so the backend can answer where it last chose', async () => {
  const browse = vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker({ id: 'export-path' })
  expect(browse).toHaveBeenCalledWith(null, false, 'export-path')
})

test('choosing remembers the directory the picker was standing in', async () => {
  vi.spyOn(api, 'browse').mockResolvedValue(listing())
  const remember = vi
    .spyOn(api, 'rememberPickerLocation')
    .mockResolvedValue({ scope: 'test-path', path: '/home/you/adventures' })
  await openPicker()
  // Hand-editing the box does not move what is remembered: the location is
  // where the user was looking, not where the text happens to point.
  fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/elsewhere/new.osr' } })
  fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
  expect(remember).toHaveBeenCalledWith('test-path', '/home/you/adventures')
})

test('a failed remember never costs the user their choice', async () => {
  vi.spyOn(api, 'browse').mockResolvedValue(listing())
  vi.spyOn(api, 'rememberPickerLocation').mockRejectedValue(new Error('config is read-only'))
  const onChange = await openPicker({ value: '~/adventures' })
  fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
  expect(onChange).toHaveBeenCalledWith('~/adventures')
})

test('an unreadable directory says so in place and leaves the picker usable', async () => {
  const browse = vi.spyOn(api, 'browse').mockResolvedValue(listing())
  await openPicker()
  browse.mockRejectedValueOnce(
    new ApiRequestError(422, {
      code: 'path_not_readable',
      message: 'cannot read the directory /home/you/walled',
      remedy: 'Browse somewhere you have permission to read, or type the path directly.',
      details: null,
    }),
  )
  fireEvent.click(screen.getByText('mill.osr'))
  expect(await screen.findByText(/cannot read the directory/)).toBeInTheDocument()
  // The refused directory never became the location, so up still walks the
  // directory the user came from.
  expect(screen.getByTestId('picker-location')).toHaveTextContent('~/adventures')
  fireEvent.click(screen.getByLabelText('Show hidden'))
  await waitFor(() => expect(browse).toHaveBeenLastCalledWith('/home/you/adventures', true))
})

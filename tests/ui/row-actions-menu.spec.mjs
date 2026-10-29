import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import webpackModule from 'next/dist/compiled/webpack/webpack.js'

test('keyboard navigation skips responsive hidden menu items', async ({ page }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'row-actions-menu-'))
  try {
    const source = await readFile('components/RowActionsMenu.tsx', 'utf8')
    await writeFile(path.join(dir, 'menu.js'), ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
    }).outputText)
    await writeFile(path.join(dir, 'entry.js'), `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Menu from './menu.js';
      createRoot(document.getElementById('root')).render(React.createElement(Menu, {
        label: 'Actions', actions: [
          { label: 'Rename', mobileOnly: true, onSelect() {} },
          { label: 'Reminder', mobileOnly: true, onSelect() {} },
          { label: 'Archive', onSelect() {} },
          { label: 'Delete', onSelect() {} },
        ],
      }));
    `)
    await new Promise((resolve, reject) => webpackModule.webpack({
      mode: 'development', entry: path.join(dir, 'entry.js'),
      output: { path: dir, filename: 'bundle.js' },
      resolve: { modules: [path.resolve('node_modules'), 'node_modules'] },
    }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()))

    await page.setViewportSize({ width: 1000, height: 800 })
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><style>@media (min-width: 640px) { .sm\\:hidden { display: none } }</style><div id="root"></div><button>After</button>')
    await page.addScriptTag({ path: path.join(dir, 'bundle.js') })
    const trigger = page.getByRole('button', { name: 'Actions' })
    const item = name => page.getByRole('menuitem', { name })
    await trigger.click()
    await expect(item('Archive')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(item('Delete')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(item('Archive')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(item('Delete')).toBeFocused()

    await page.setViewportSize({ width: 500, height: 800 })
    await page.keyboard.press('ArrowDown')
    await expect(item('Rename')).toBeFocused()
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.keyboard.press('ArrowUp')
    await expect(item('Delete')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'After' })).toBeFocused()
    await expect(page.getByRole('menu')).toHaveCount(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

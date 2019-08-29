#!/usr/bin/env node

const chalk = require('chalk')
const { readFileSync, writeFileSync } = require('fs')
const compileToJSSource = require('../src/js-ssr').compileToSource
const compileToPHPSource = require('../src/php-ssr').compileToSource
const { resolve, join } = require('path')
const caseRoot = resolve(__dirname, '../test/cases')
const { render } = require('../src/render')

const caseName = process.argv[2]
const caseDir = join(caseRoot, caseName)
const htmlPath = join(caseDir, 'result.html')
const jsSSRPath = join(caseDir, 'ssr.js')
const phpSSRPath = join(caseDir, 'ssr.php')
const compPath = join(caseDir, 'component.js')

// generate js ssr
delete require.cache[require.resolve(compPath)]
const ComponentClass = require(compPath)
const fn = compileToJSSource(ComponentClass)
writeFileSync(jsSSRPath, `module.exports = ${fn}`)

// generate php ssr
delete require.cache[require.resolve(compPath)]
const ComponentClassForPHP = require(compPath)
const php = compileToPHPSource(ComponentClassForPHP)
writeFileSync(phpSSRPath, `<?php $render = ${php}; ?>`)

// check
const expected = readFileSync(htmlPath, 'utf8')
console.log(chalk.green('[EXPECTED]'))
console.log(expected)
console.log()

check(`[SSR:  JS] ${jsSSRPath}`, render(caseName, 'js'))
check(`[SSR: PHP] ${phpSSRPath}`, render(caseName, 'php'))

function check (title, html) {
    const color = html === expected ? 'green' : 'red'
    console.log(chalk[color](title))
    console.log(html)
    console.log()
    if (html !== expected) process.exit(1)
}

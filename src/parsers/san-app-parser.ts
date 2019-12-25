import { getComponentClassIdentifier, isChildClassOf } from '../utils/ast-util'
import { resolve } from 'path'
import { ComponentClassFinder } from './component-class-finder'
import { CommonJS, Modules } from '../loaders/common-js'
import { tsSourceFile2js } from '../transpilers/ts2js'
import { normalizeComponentClass } from './normalize-component'
import { SanSourceFile } from '../models/san-sourcefile'
import { Project, SourceFile, ClassDeclaration } from 'ts-morph'
import { getDefaultTSConfigPath } from './tsconfig'
import { getDependenciesRecursively } from './dependency-resolver'
import { SanApp } from '../models/san-app'
import { Component } from 'san'
import { SourceFileType, getSourceFileTypeOrThrow } from '../models/source-file-type'
import debugFactory from 'debug'

const debug = debugFactory('component-parser')

export class SanAppParser {
    public project: Project
    private root: string
    private id: number = 0
    private cache: Map<string, SanSourceFile> = new Map()
    private projectFiles: Map<string, SanSourceFile> = new Map()
    private commonJS: CommonJS
    private modules = {}

    constructor (project: Project) {
        debug('SanAppParser created')
        this.project = project
        this.commonJS = new CommonJS(this.modules, filepath => {
            if (!this.projectFiles.has(filepath)) return undefined
            const sourceFile = this.projectFiles.get(filepath)
            return tsSourceFile2js(sourceFile.tsSourceFile, this.project.getCompilerOptions())
        })
    }

    static createUsingTsconfig (tsConfigFilePath: string) {
        return new SanAppParser(new Project({ tsConfigFilePath }))
    }

    static createUsingDefaultTypeScriptConfig () {
        return SanAppParser.createUsingTsconfig(getDefaultTSConfigPath())
    }

    public parseSanAppFromComponentClass (componentClass: typeof Component) {
        const sourceFile = SanSourceFile.createVirtualSourceFile()
        return new SanApp(sourceFile, this.projectFiles, [componentClass as any])
    }

    public parseSanApp (entryFilePath: string, modules: Modules = {}): SanApp {
        debug('parsComponent', entryFilePath)
        entryFilePath = resolve(entryFilePath)
        this.project.addExistingSourceFileIfExists(entryFilePath)
        const entrySourceFile = getSourceFileTypeOrThrow(entryFilePath) === SourceFileType.js
            ? SanSourceFile.createFromJSFilePath(entryFilePath)
            : this.parseSanSourceFile(this.project.getSourceFileOrThrow(entryFilePath))

        this.projectFiles.set(entryFilePath, entrySourceFile)

        if (entrySourceFile.fileType === SourceFileType.ts) {
            const sourceFiles = getDependenciesRecursively(entrySourceFile.tsSourceFile)

            for (const [path, file] of sourceFiles) {
                this.projectFiles.set(path, this.parseSanSourceFile(file))
            }
        }

        const entryClass = this.evaluateFile(entrySourceFile, modules)
        const componentClasses = new ComponentClassFinder(entryClass).find()

        if (entrySourceFile.fileType === SourceFileType.js) {
            for (let i = 0; i < componentClasses.length; i++) {
                const componentClass = componentClasses[i]
                componentClass.sanssrCid = i
            }
        }
        return new SanApp(entrySourceFile, this.projectFiles, componentClasses)
    }

    private evaluateFile (sourceFile: SanSourceFile, modules: Modules) {
        // TODO move entryFile to constructor argument and remove this branch
        if (sourceFile.fileType === SourceFileType.js) {
            return new CommonJS(this.modules).require(sourceFile.getFilePath())
        }
        Object.assign(this.modules, modules)
        return this.commonJS.require(sourceFile.getFilePath()).default
    }

    private parseSanSourceFile (sourceFile: SourceFile) {
        const filePath = sourceFile.getFilePath()
        if (!this.cache.has(filePath)) {
            this.cache.set(filePath, this.doParseSanSourceFile(sourceFile))
        }
        return this.cache.get(filePath)
    }

    private doParseSanSourceFile (sourceFile: SourceFile) {
        debug('parseSanSourceFile', sourceFile.getFilePath())
        sourceFile.refreshFromFileSystemSync()
        const componentClassIdentifier = getComponentClassIdentifier(sourceFile)
        const sanSourceFile = SanSourceFile.createFromTSSourceFile(sourceFile, componentClassIdentifier)

        if (!componentClassIdentifier) return sanSourceFile
        debug('san identifier', componentClassIdentifier)

        for (const clazz of sourceFile.getClasses()) {
            if (!isChildClassOf(clazz, componentClassIdentifier)) continue
            normalizeComponentClass(clazz)
            this.setComponentID(sanSourceFile, clazz)
        }
        return sanSourceFile
    }

    public setComponentID (sourceFile: SanSourceFile, clazz: ClassDeclaration) {
        const decl = clazz.addProperty({
            isStatic: true,
            name: 'sanssrCid',
            type: 'number',
            initializer: String(this.id)
        })
        sourceFile.fakeProperties.push(decl)
        sourceFile.componentClassDeclarations.set(this.id++, clazz)
    }
}

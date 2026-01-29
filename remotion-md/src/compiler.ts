import ts from 'typescript';

export interface CompileResult {
    code: string;
    diagnostics: readonly ts.Diagnostic[];
}

export function compileVirtualModule(
    fileName: string,
    sourceText: string
): CompileResult {
    const compilerOptions: ts.CompilerOptions = {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        noEmitOnError: false,
        noLib: true,
        skipLibCheck: true,
        esModuleInterop: true,
    };

    const files = new Map<string, string>([[fileName, sourceText]]);

    const host: ts.CompilerHost = {
        getSourceFile: (name, languageVersion) => {
            const text = files.get(name);
            if (text !== undefined) {
                return ts.createSourceFile(name, text, languageVersion, true);
            }
            return undefined;
        },
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => '/',
        getDirectories: () => [],
        fileExists: (name) => files.has(name),
        readFile: (name) => files.get(name),
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
    };

    let output = '';
    const program = ts.createProgram([fileName], compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    program.emit(
        undefined,
        (_fileName, text) => {
            output = text;
        },
        undefined,
        false,
        undefined
    );

    return { code: output, diagnostics };
}

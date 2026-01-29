import { EditorView, Decoration } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import type { MarkdownDiagnostic } from 'remotion-md';

const setDiagnosticsEffect = StateEffect.define<MarkdownDiagnostic[]>();

function buildDecorations(state: EditorView['state'], diagnostics: MarkdownDiagnostic[]) {
    const ranges = [] as Array<ReturnType<Decoration['range']>>;

    for (const diagnostic of diagnostics) {
        const lineNumber = diagnostic.line;
        if (lineNumber < 1 || lineNumber > state.doc.lines) continue;

        const lineInfo = state.doc.line(lineNumber);
        const column = Math.max(0, Math.min(diagnostic.column, lineInfo.length));
        const from = lineInfo.from + column;
        // Try to expand to the next word/token or until whitespace/end of line
        let to = from;
        const text = state.doc.sliceString(from, lineInfo.to);
        const match = text.match(/^\w+/);
        if (match) {
            to = from + match[0].length;
        } else {
            to = Math.min(from + 1, lineInfo.to);
        }
        if (to <= from) continue;

        const severityClass = diagnostic.category === 'warning'
            ? 'remotion-diagnostic--warning'
            : diagnostic.category === 'suggestion'
                ? 'remotion-diagnostic--info'
                : diagnostic.category === 'message'
                    ? 'remotion-diagnostic--info'
                    : 'remotion-diagnostic--error';

        const mark = Decoration.mark({
            class: `remotion-diagnostic ${severityClass}`,
            attributes: {
                'data-remotion-diagnostic': diagnostic.message,
                title: diagnostic.message,
            },
        });
        ranges.push(mark.range(from, to));
    }

    return Decoration.set(ranges, true);
}

const diagnosticsField = StateField.define<ReturnType<typeof buildDecorations>>({
    create(state) {
        return buildDecorations(state, []);
    },
    update(decorations, transaction) {
        let next = decorations.map(transaction.changes);

        for (const effect of transaction.effects) {
            if (effect.is(setDiagnosticsEffect)) {
                next = buildDecorations(transaction.state, effect.value);
            }
        }

        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export const editorDiagnosticsExtension: Extension = [diagnosticsField];

export function applyEditorDiagnostics(view: EditorView, diagnostics: MarkdownDiagnostic[]) {
    console.debug('[remotion][cm] apply diagnostics', diagnostics.length);
    const effects = [setDiagnosticsEffect.of(diagnostics)];
    console.debug('[remotion][cm] dispatch diagnostics', effects.length);
    view.dispatch({
        effects,
    });
}

export function clearEditorDiagnostics(view: EditorView) {
    console.debug('[remotion][cm] clear diagnostics');
    const effects = [setDiagnosticsEffect.of([])];
    view.dispatch({
        effects,
    });
}